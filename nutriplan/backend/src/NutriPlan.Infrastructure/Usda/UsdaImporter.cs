using System.Globalization;
using CsvHelper;
using CsvHelper.Configuration;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using NutriPlan.Domain.Foods;
using NutriPlan.Domain.Nutrients;
using NutriPlan.Infrastructure.Persistence;

namespace NutriPlan.Infrastructure.Usda;

public sealed record UsdaImportResult(string Dataset, int Read, int Imported, int Skipped);

/// <summary>
/// Imports a USDA FoodData Central CSV download (https://fdc.nal.usda.gov/download-datasets) into the foods table.
/// Supported: Foundation, SR Legacy, Survey (FNDDS) and Branded. Point it at the folder that contains food.csv.
/// Idempotent: foods already imported (same source + fdc_id) are skipped, so re-running is safe.
///
/// Accuracy notes:
///  • Foundation foods often have no "Energy (1008)" row; we use Atwater Specific (2048), then General (2047).
///  • Sugars are 2000 in newer data and 1063 in some; both map to total sugars.
///  • Only the nutrients in <see cref="NutrientCatalog"/> are kept (≈35), which keeps rows small.
/// </summary>
public sealed class UsdaImporter(NutriPlanDbContext db, ILogger<UsdaImporter> logger)
{
    private const int BatchSize = 2000;

    private static readonly Dictionary<string, FoodSource> DataTypes = new()
    {
        ["foundation_food"] = FoodSource.UsdaFoundation,
        ["sr_legacy_food"] = FoodSource.UsdaSrLegacy,
        ["survey_fndds_food"] = FoodSource.UsdaSurvey,
        ["branded_food"] = FoodSource.UsdaBranded,
    };

    private static readonly CsvConfiguration Csv = new(CultureInfo.InvariantCulture)
    {
        HasHeaderRecord = true,
        MissingFieldFound = null,
        BadDataFound = null,
    };

    public async Task<UsdaImportResult> ImportAsync(string folder, CancellationToken ct = default)
    {
        var foodCsv = Path.Combine(folder, "food.csv");
        if (!File.Exists(foodCsv)) throw new FileNotFoundException("food.csv not found. Point to the extracted FoodData Central folder.", foodCsv);

        logger.LogInformation("Reading USDA data from {Folder}", folder);

        // 1) Which foods to import (by data type), with names and categories.
        var categories = ReadCategories(Path.Combine(folder, "food_category.csv"));
        foreach (var (id, name) in ReadWweiaCategories(Path.Combine(folder, "wweia_food_category.csv"))) categories.TryAdd(id, name);
        var foods = new Dictionary<long, UsdaFoodRow>();
        using (var reader = Open(foodCsv))
        {
            foreach (var row in reader.GetRecords<UsdaFoodRow>())
                if (DataTypes.ContainsKey(row.data_type)) foods[row.fdc_id] = row;
        }
        if (foods.Count == 0) return new UsdaImportResult("(none)", 0, 0, 0);
        var dataset = string.Join(", ", foods.Values.Select(f => f.data_type).Distinct());
        logger.LogInformation("{Count} foods of type {Types}", foods.Count, dataset);

        // 2) Branded extras (brand, barcode, serving, category) when present.
        var branded = new Dictionary<long, UsdaBrandedRow>();
        var brandedCsv = Path.Combine(folder, "branded_food.csv");
        if (File.Exists(brandedCsv))
        {
            using var reader = Open(brandedCsv);
            foreach (var row in reader.GetRecords<UsdaBrandedRow>())
                if (foods.ContainsKey(row.fdc_id)) branded[row.fdc_id] = row;
        }

        // 3) Nutrients (streamed; the branded file is large).
        //    FNDDS (survey) files put the legacy nutrient *number* (208 = energy) in nutrient_id; translate those.
        var legacyNumbers = ReadLegacyNutrientNumbers(Path.Combine(folder, "nutrient.csv"));
        var nutrients = new Dictionary<long, Dictionary<int, double>>();
        var tracked = NutrientCatalog.TrackedIds.Concat([NutrientIds.EnergyAtwaterGeneral, NutrientIds.EnergyAtwaterSpecific, NutrientIds.SugarsTotalNlea]).ToHashSet();
        using (var reader = Open(Path.Combine(folder, "food_nutrient.csv")))
        {
            foreach (var row in reader.GetRecords<UsdaFoodNutrientRow>())
            {
                if (row.fdc_id is not { } fdc || row.nutrient_id is not { } nid || row.amount is null) continue;
                if (nid < 1000 && legacyNumbers.TryGetValue(nid, out var translated)) nid = translated;
                if (!tracked.Contains(nid) || !foods.ContainsKey(fdc)) continue;
                if (!nutrients.TryGetValue(fdc, out var map)) nutrients[fdc] = map = new();
                map[nid] = row.amount.Value;
            }
        }

        // 4) Portions.
        var units = ReadMeasureUnits(Path.Combine(folder, "measure_unit.csv"));
        var portions = new Dictionary<long, List<FoodPortion>>();
        var portionCsv = Path.Combine(folder, "food_portion.csv");
        if (File.Exists(portionCsv))
        {
            using var reader = Open(portionCsv);
            foreach (var row in reader.GetRecords<UsdaPortionRow>())
            {
                if (row.fdc_id is not { } fdc || !foods.ContainsKey(fdc) || row.gram_weight is not > 0) continue;
                if (NormalizePortion(PortionDescription(row, units), row.amount) is not var (description, amount)) continue;
                if (!portions.TryGetValue(fdc, out var list)) portions[fdc] = list = [];
                list.Add(new FoodPortion(description, row.gram_weight.Value, amount));
            }
        }

        // 5) Skip what's already imported.
        var sources = foods.Values.Select(f => DataTypes[f.data_type]).Distinct().ToList();
        var existing = (await db.Foods.AsNoTracking().Where(f => sources.Contains(f.Source) && f.SourceId != null)
            .Select(f => f.SourceId!).ToListAsync(ct)).ToHashSet();

        var imported = 0; var skipped = 0;
        db.ChangeTracker.AutoDetectChangesEnabled = false;
        var batch = new List<Food>(BatchSize);

        foreach (var (fdcId, row) in foods)
        {
            var id = fdcId.ToString(CultureInfo.InvariantCulture);
            if (existing.Contains(id)) { skipped++; continue; }
            if (!nutrients.TryGetValue(fdcId, out var map) || !Normalize(map)) { skipped++; continue; }

            branded.TryGetValue(fdcId, out var b);
            var foodPortions = portions.GetValueOrDefault(fdcId) ?? [];
            if (b is { serving_size: > 0 } && (b.serving_size_unit is "g" or "GRM" or "G"))
                foodPortions.Insert(0, new FoodPortion(string.IsNullOrWhiteSpace(b.household_serving_fulltext) ? "serving" : $"serving ({b.household_serving_fulltext.Trim().ToLowerInvariant()})", b.serving_size.Value));

            var category = b?.branded_food_category ?? (row.food_category_id is { } cid && categories.TryGetValue(cid, out var c) ? c : null);
            var food = new Food(
                b is null ? row.description : TitleCase(row.description),
                DataTypes[row.data_type],
                new NutrientProfile(map),
                sourceId: id,
                brand: b is null ? null : TitleCase(b.brand_name ?? b.brand_owner ?? ""),
                barcode: b?.gtin_upc,
                category: category,
                portions: foodPortions);

            batch.Add(food);
            if (batch.Count >= BatchSize)
            {
                imported += await FlushAsync(batch, ct);
                logger.LogInformation("Imported {Count}…", imported);
            }
        }
        imported += await FlushAsync(batch, ct);
        db.ChangeTracker.AutoDetectChangesEnabled = true;

        logger.LogInformation("USDA import done: {Imported} imported, {Skipped} skipped", imported, skipped);
        return new UsdaImportResult(dataset, foods.Count, imported, skipped);
    }

    /// <summary>Fills energy/sugar from alternates; returns false if the food has no usable energy value.</summary>
    public static bool Normalize(Dictionary<int, double> map)
    {
        if (!map.ContainsKey(NutrientIds.Energy))
        {
            if (map.TryGetValue(NutrientIds.EnergyAtwaterSpecific, out var s)) map[NutrientIds.Energy] = s;
            else if (map.TryGetValue(NutrientIds.EnergyAtwaterGeneral, out var g)) map[NutrientIds.Energy] = g;
        }
        if (!map.ContainsKey(NutrientIds.SugarsTotal) && map.TryGetValue(NutrientIds.SugarsTotalNlea, out var sugar))
            map[NutrientIds.SugarsTotal] = sugar;
        map.Remove(NutrientIds.EnergyAtwaterGeneral);
        map.Remove(NutrientIds.EnergyAtwaterSpecific);
        map.Remove(NutrientIds.SugarsTotalNlea);
        return map.ContainsKey(NutrientIds.Energy);
    }

    /// <summary>"1 cup, chopped" style text from the portion row (unit name + description + modifier).</summary>
    public static string PortionDescription(UsdaPortionRow row, IReadOnlyDictionary<int, string> units)
    {
        var parts = new List<string>();
        if (row.measure_unit_id is { } uid && uid != 9999 && units.TryGetValue(uid, out var unitName) && unitName != "undetermined")
            parts.Add(unitName);
        if (!string.IsNullOrWhiteSpace(row.portion_description) && !row.portion_description.Equals("Quantity not specified", StringComparison.OrdinalIgnoreCase))
            parts.Add(row.portion_description.Trim());
        if (!string.IsNullOrWhiteSpace(row.modifier) && !int.TryParse(row.modifier, out _))
            parts.Add(row.modifier.Trim());
        return string.Join(", ", parts.Distinct(StringComparer.OrdinalIgnoreCase));
    }

    /// <summary>
    /// Survey (FNDDS) descriptions carry their own amount ("1 cup", "1/2 cup"); move it into Amount so
    /// "cup" is recognised as a volume. Drops entries that would mislead conversions:
    /// "Guideline amount ..." and "1 cup, dry, yields" (that's cooked weight, not a cup of the food).
    /// </summary>
    public static (string Description, double Amount)? NormalizePortion(string description, double? amount)
    {
        if (description.Length == 0) return null;
        if (description.StartsWith("Guideline", StringComparison.OrdinalIgnoreCase)) return null;
        if (description.Contains("yields", StringComparison.OrdinalIgnoreCase)) return null;

        var leading = System.Text.RegularExpressions.Regex.Match(description, @"^\s*(\d+(?:[./]\d+)?(?:\s+\d+/\d+)?)\s+(\S.*)$");
        if (leading.Success && NutriPlan.Domain.Parsing.QuantityTextParser.Parse(leading.Groups[1].Value + " x").Amount is > 0 and var parsedAmount)
            return (leading.Groups[2].Value.Trim(), parsedAmount);
        return (description, amount is > 0 ? amount.Value : 1);
    }

    private async Task<int> FlushAsync(List<Food> batch, CancellationToken ct)
    {
        if (batch.Count == 0) return 0;
        db.Foods.AddRange(batch);
        db.ChangeTracker.DetectChanges();
        await db.SaveChangesAsync(ct);
        db.ChangeTracker.Clear();
        var n = batch.Count;
        batch.Clear();
        return n;
    }

    private static Dictionary<int, string> ReadCategories(string path)
    {
        if (!File.Exists(path)) return [];
        using var reader = Open(path);
        return reader.GetRecords<UsdaCategoryRow>().ToDictionary(r => r.id, r => r.description);
    }

    /// <summary>Survey (FNDDS) foods use "What We Eat in America" categories instead of food_category.csv.</summary>
    private static Dictionary<int, string> ReadWweiaCategories(string path)
    {
        if (!File.Exists(path)) return [];
        using var reader = Open(path);
        return reader.GetRecords<UsdaWweiaRow>().ToDictionary(r => r.wweia_food_category, r => r.wweia_food_category_description);
    }

    /// <summary>Legacy nutrient number (e.g. 208) → current nutrient id (e.g. 1008), from nutrient.csv.</summary>
    private static Dictionary<int, int> ReadLegacyNutrientNumbers(string path)
    {
        var map = new Dictionary<int, int>();
        if (!File.Exists(path)) return map;
        using var reader = Open(path);
        foreach (var row in reader.GetRecords<UsdaNutrientRow>())
        {
            if (double.TryParse(row.nutrient_nbr, NumberStyles.Float, CultureInfo.InvariantCulture, out var nbr) && nbr == Math.Floor(nbr))
                map.TryAdd((int)nbr, row.id);
        }
        return map;
    }

    private static Dictionary<int, string> ReadMeasureUnits(string path)
    {
        if (!File.Exists(path)) return [];
        using var reader = Open(path);
        return reader.GetRecords<UsdaMeasureUnitRow>().ToDictionary(r => r.id, r => r.name);
    }

    private static CsvReader Open(string path) => new(new StreamReader(path), Csv);

    private static string TitleCase(string s) =>
        string.IsNullOrWhiteSpace(s) ? s : s.Any(char.IsLower) ? s.Trim() : CultureInfo.InvariantCulture.TextInfo.ToTitleCase(s.Trim().ToLowerInvariant());

    // CSV row shapes (names match USDA headers).
#pragma warning disable IDE1006
    public sealed class UsdaFoodRow { public long fdc_id { get; set; } public string data_type { get; set; } = ""; public string description { get; set; } = ""; public int? food_category_id { get; set; } }
    public sealed class UsdaFoodNutrientRow { public long? fdc_id { get; set; } public int? nutrient_id { get; set; } public double? amount { get; set; } }
    public sealed class UsdaPortionRow { public long? fdc_id { get; set; } public double? amount { get; set; } public int? measure_unit_id { get; set; } public string? portion_description { get; set; } public string? modifier { get; set; } public double? gram_weight { get; set; } }
    public sealed class UsdaWweiaRow { public int wweia_food_category { get; set; } public string wweia_food_category_description { get; set; } = ""; }
    public sealed class UsdaNutrientRow { public int id { get; set; } public string? nutrient_nbr { get; set; } }
    public sealed class UsdaMeasureUnitRow { public int id { get; set; } public string name { get; set; } = ""; }
    public sealed class UsdaCategoryRow { public int id { get; set; } public string description { get; set; } = ""; }
    public sealed class UsdaBrandedRow
    {
        public long fdc_id { get; set; }
        public string? brand_owner { get; set; }
        public string? brand_name { get; set; }
        public string? gtin_upc { get; set; }
        public double? serving_size { get; set; }
        public string? serving_size_unit { get; set; }
        public string? household_serving_fulltext { get; set; }
        public string? branded_food_category { get; set; }
    }
#pragma warning restore IDE1006
}
