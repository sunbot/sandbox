using System.Globalization;
using System.Net;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using NutriPlan.Application.Abstractions;
using NutriPlan.Domain.Foods;
using NutriPlan.Domain.Nutrients;

namespace NutriPlan.Infrastructure.External;

public sealed class UsdaOptions
{
    public const string Section = "Usda";
    /// <summary>api.data.gov key for FoodData Central (free). Backend only: set it as Usda__ApiKey on the server.</summary>
    public string? ApiKey { get; set; }
}

/// <summary>
/// USDA FoodData Central "Branded" search (manufacturer labels, public domain / CC0; USDA asks to be credited as the
/// source). Nutrients come per 100 g, or per 100 ml when the label's serving is in ml. Only nutrients the app tracks, in
/// the app's units, are kept; anything else (e.g. vitamin A in IU) is left out rather than converted.
/// </summary>
public sealed partial class UsdaBrandedProvider(HttpClient http, IOptions<UsdaOptions> options, ILogger<UsdaBrandedProvider> logger) : IBrandedFoodProvider
{
    public string Name => "USDA FoodData Central";
    public bool IsConfigured => !string.IsNullOrWhiteSpace(options.Value.ApiKey);

    public async Task<BrandedSearch> SearchAsync(string query, int limit, CancellationToken ct = default)
    {
        var (doc, failure) = await GetJsonAsync($"foods/search?dataType=Branded&pageSize={Math.Clamp(limit, 1, 100)}&query={Uri.EscapeDataString(query)}", ct);
        if (doc is null) return new([], failure);
        using (doc)
        {
            if (!doc.RootElement.TryGetProperty("foods", out var list) || list.ValueKind != JsonValueKind.Array) return new([], ProviderFailure.BadResponse);
            return new(list.EnumerateArray().Select(Parse).OfType<BrandedProduct>().ToList());
        }
    }

    public async Task<BrandedFetch> GetAsync(string sourceId, CancellationToken ct = default)
    {
        var (doc, failure) = await GetJsonAsync($"food/{Uri.EscapeDataString(sourceId)}", ct);
        if (doc is null) return new(null, failure);
        using (doc) return new(Parse(doc.RootElement));
    }

    /// <summary>USDA stores UPCs as printed (12 digits) or zero-padded; both forms are searched and compared normalized.</summary>
    public async Task<BrandedFetch> FindByBarcodeAsync(string normalizedBarcode, CancellationToken ct = default)
    {
        var upc = normalizedBarcode.Length == 13 && normalizedBarcode[0] == '0' ? normalizedBarcode[1..] : normalizedBarcode;
        var found = await SearchAsync(upc, 10, ct);
        if (found.Failure is not null) return new(null, found.Failure);
        return new(found.Products.FirstOrDefault(p => p.Barcode == normalizedBarcode));
    }

    private async Task<(JsonDocument? Doc, ProviderFailure? Failure)> GetJsonAsync(string path, CancellationToken ct)
    {
        if (!IsConfigured) return (null, ProviderFailure.BadResponse);
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, path);
            request.Headers.Add("X-Api-Key", options.Value.ApiKey); // a header, so the key never appears in a URL or log line
            using var response = await http.SendAsync(request, ct);
            if (response.StatusCode == HttpStatusCode.TooManyRequests) return (null, ProviderFailure.RateLimited);
            if (response.StatusCode == HttpStatusCode.NotFound) return (null, null);
            if ((int)response.StatusCode >= 500) return (null, ProviderFailure.Network);
            if (!response.IsSuccessStatusCode)
            {
                logger.LogWarning("USDA FoodData Central answered {Status} (check Usda__ApiKey)", (int)response.StatusCode);
                return (null, ProviderFailure.BadResponse);
            }
            await using var stream = await response.Content.ReadAsStreamAsync(ct);
            return (await JsonDocument.ParseAsync(stream, cancellationToken: ct), null);
        }
        catch (TaskCanceledException) when (!ct.IsCancellationRequested) { return (null, ProviderFailure.Timeout); }
        catch (HttpRequestException ex) { logger.LogWarning(ex, "USDA FoodData Central unreachable"); return (null, ProviderFailure.Network); }
        catch (JsonException ex) { logger.LogWarning(ex, "USDA FoodData Central sent unreadable JSON"); return (null, ProviderFailure.BadResponse); }
    }

    /// <summary>One search hit or a food detail document → a normalized product. Null when it isn't usable.</summary>
    public static BrandedProduct? Parse(JsonElement f)
    {
        if (f.ValueKind != JsonValueKind.Object || !f.TryGetProperty("fdcId", out var idEl)) return null;
        var id = idEl.ValueKind == JsonValueKind.Number ? idEl.GetInt64().ToString(CultureInfo.InvariantCulture) : idEl.GetString();
        var description = Str(f, "description");
        if (string.IsNullOrWhiteSpace(id) || string.IsNullOrWhiteSpace(description)) return null;

        var unit = (Str(f, "servingSizeUnit") ?? "").Trim().ToLowerInvariant();
        var basis = unit is "ml" or "mlt" ? NutrientBasis.Volume : NutrientBasis.Mass;
        var nutrients = Nutrients(f);
        if (nutrients.Count == 0) return null;

        var portions = new List<FoodPortion>();
        if (Num(f, "servingSize") is > 0 and var size && unit is ("g" or "grm" or "ml" or "mlt"))
            portions.Add(Serving(Str(f, "householdServingFullText"), size));

        var brand = Tidy(Str(f, "brandName") ?? Str(f, "brandOwner"));
        var name = DropRepeats(Tidy(description)!);
        // "DAVE'S KILLER BREAD, WHITE BREAD" under the brand "Dave's Killer Bread" reads better as "White Bread".
        if (brand is not null && name.StartsWith(brand + ",", StringComparison.OrdinalIgnoreCase) && name.Length > brand.Length + 2)
            name = name[(brand.Length + 1)..].Trim();

        return new BrandedProduct(FoodSource.UsdaBranded, id!, name, brand, Food.NormalizeBarcode(Str(f, "gtinUpc")),
            new NutrientProfile(nutrients), basis, portions, Date(Str(f, "modifiedDate") ?? Str(f, "publishedDate")));
    }

    /// <summary>"1 SLICE" → "slice"; "0.5 BAR" → "0.5 bar serving"; nothing usable → "serving".</summary>
    private static FoodPortion Serving(string? household, double baseAmount)
    {
        var m = household is null ? null : HouseholdRegex().Match(household.Trim());
        if (m is { Success: true } && double.TryParse(m.Groups[1].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var n) && n > 0)
        {
            var word = m.Groups[2].Value.Trim().ToLowerInvariant().TrimEnd('.');
            word = UnitCodes.GetValueOrDefault(word, word); // label codes: ONZ → oz, OZA → fl oz
            if (word.Length > 0 && word.Length <= 40 && !word.Any(char.IsDigit))
                // "0.5 bar": keep the label's serving as one tap ("0.5 bar serving") rather than a whole bar the label never weighed.
                return n == 1 ? new FoodPortion(word, baseAmount) : new FoodPortion($"{n.ToString("0.##", CultureInfo.InvariantCulture)} {word} serving", baseAmount);
        }
        return new FoodPortion("serving", baseAmount);
    }

    /// <summary>GS1/FDA unit codes USDA passes through from labels.</summary>
    private static readonly Dictionary<string, string> UnitCodes = new()
    {
        ["onz"] = "oz", ["oza"] = "fl oz", ["grm"] = "g", ["mlt"] = "ml", ["ltr"] = "l", ["lbr"] = "lb", ["tbsp"] = "tbsp", ["tsp"] = "tsp",
        ["cup"] = "cup", ["pc"] = "piece", ["pcs"] = "pieces", ["ea"] = "each",
    };

    /// <summary>"Banana Maple, Banana Maple" → "Banana Maple": USDA descriptions sometimes repeat a segment.</summary>
    private static string DropRepeats(string name)
    {
        var parts = name.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);
        var kept = new List<string>();
        foreach (var p in parts) if (!kept.Contains(p, StringComparer.OrdinalIgnoreCase)) kept.Add(p);
        return string.Join(", ", kept);
    }

    private static Dictionary<int, double> Nutrients(JsonElement f)
    {
        var result = new Dictionary<int, double>();
        if (!f.TryGetProperty("foodNutrients", out var list) || list.ValueKind != JsonValueKind.Array) return result;
        foreach (var n in list.EnumerateArray())
        {
            // Search hits: {nutrientId, unitName, value}. Detail: {nutrient: {id, unitName}, amount}.
            int? id; string? unitName; double? value;
            if (n.TryGetProperty("nutrient", out var inner) && inner.ValueKind == JsonValueKind.Object)
                (id, unitName, value) = (Int(inner, "id"), Str(inner, "unitName"), Num(n, "amount"));
            else
                (id, unitName, value) = (Int(n, "nutrientId"), Str(n, "unitName"), Num(n, "value"));
            if (id is null || value is null || value < 0 || NutrientCatalog.Find(id.Value) is not { } def) continue;
            if (!SameUnit(def.Unit, unitName)) continue; // e.g. vitamin A in IU: different quantity, not converted
            result[id.Value] = Math.Round(value.Value, 4);
        }
        return result;
    }

    private static bool SameUnit(string ours, string? theirs)
    {
        var t = (theirs ?? "").Trim().ToLowerInvariant().Replace("ug", "µg").Replace("mcg", "µg");
        return string.Equals(ours.Trim().ToLowerInvariant().Replace("mcg", "µg"), t, StringComparison.Ordinal);
    }

    /// <summary>"KIRKLAND SIGNATURE" → "Kirkland Signature"; mixed-case names are left as the manufacturer wrote them.</summary>
    private static string? Tidy(string? s)
    {
        if (string.IsNullOrWhiteSpace(s)) return null;
        s = Regex.Replace(s.Trim(), @"\s+", " ");
        var letters = s.Where(char.IsLetter).ToList();
        if (letters.Count > 0 && letters.Count(char.IsUpper) > letters.Count * 0.8)
            s = CultureInfo.InvariantCulture.TextInfo.ToTitleCase(s.ToLowerInvariant()).Replace("'S ", "'s ").Replace("’S ", "’s ");
        return s;
    }

    private static DateOnly? Date(string? s) =>
        DateOnly.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.None, out var d) ? d
        : DateTime.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.None, out var dt) ? DateOnly.FromDateTime(dt) : null;

    private static string? Str(JsonElement e, string name) => e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
    private static double? Num(JsonElement e, string name) => e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetDouble() : null;
    private static int? Int(JsonElement e, string name) => e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetInt32(out var i) ? i : null;

    [GeneratedRegex(@"^(\d+(?:\.\d+)?)\s*(.*)$")]
    private static partial Regex HouseholdRegex();
}

/// <summary>Barcode lookups against USDA Branded (manufacturer labels), tried before Open Food Facts.</summary>
public sealed class UsdaBarcodeProvider(IBrandedFoodProvider branded) : IBarcodeProvider
{
    public string Name => "USDA FoodData Central";

    public async Task<BarcodeLookup> LookupAsync(string normalizedBarcode, CancellationToken ct = default)
    {
        if (!branded.IsConfigured) return BarcodeLookup.NotFound;
        var r = await branded.FindByBarcodeAsync(normalizedBarcode, ct);
        if (r.Failure is { } why) return BarcodeLookup.Failed(why);
        return r.Product is { } p ? BarcodeLookup.Found(Application.Foods.BrandedFoodService.ToFood(p)) : BarcodeLookup.NotFound;
    }
}
