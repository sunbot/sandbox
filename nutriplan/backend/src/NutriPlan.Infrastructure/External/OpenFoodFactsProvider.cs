using System.Globalization;
using System.Net;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using NutriPlan.Application.Abstractions;
using NutriPlan.Domain.Foods;
using NutriPlan.Domain.Nutrients;

namespace NutriPlan.Infrastructure.External;

/// <summary>
/// Barcode lookups against Open Food Facts (free, crowd-sourced, ODbL licence).
/// Values are per 100 g. OFF stores most micronutrients in grams, so they're converted to our units.
/// Foods from here start as "Unverified" and are flagged if calories don't match the macros.
/// </summary>
public sealed class OpenFoodFactsProvider(HttpClient http, ILogger<OpenFoodFactsProvider> logger) : IBarcodeProvider
{
    public string Name => "Open Food Facts";

    private const string Fields = "code,product_name,product_name_en,generic_name,brands,nutriments,serving_size,serving_quantity,categories_tags,quantity";

    /// <summary>OFF nutriment key → (our nutrient id, multiplier from OFF unit to ours).</summary>
    private static readonly (string Key, int Id, double Factor)[] Map =
    [
        ("proteins_100g", NutrientIds.Protein, 1),
        ("carbohydrates_100g", NutrientIds.Carbohydrate, 1),
        ("fat_100g", NutrientIds.Fat, 1),
        ("fiber_100g", NutrientIds.Fiber, 1),
        ("sugars_100g", NutrientIds.SugarsTotal, 1),
        ("added-sugars_100g", NutrientIds.SugarsAdded, 1),
        ("saturated-fat_100g", NutrientIds.SaturatedFat, 1),
        ("monounsaturated-fat_100g", NutrientIds.MonounsaturatedFat, 1),
        ("polyunsaturated-fat_100g", NutrientIds.PolyunsaturatedFat, 1),
        ("trans-fat_100g", NutrientIds.TransFat, 1),
        ("cholesterol_100g", NutrientIds.Cholesterol, 1000),
        ("sodium_100g", NutrientIds.Sodium, 1000),
        ("potassium_100g", NutrientIds.Potassium, 1000),
        ("calcium_100g", NutrientIds.Calcium, 1000),
        ("iron_100g", NutrientIds.Iron, 1000),
        ("magnesium_100g", NutrientIds.Magnesium, 1000),
        ("zinc_100g", NutrientIds.Zinc, 1000),
        ("phosphorus_100g", NutrientIds.Phosphorus, 1000),
        ("vitamin-a_100g", NutrientIds.VitaminA, 1_000_000),
        ("vitamin-c_100g", NutrientIds.VitaminC, 1000),
        ("vitamin-d_100g", NutrientIds.VitaminD, 1_000_000),
        ("vitamin-e_100g", NutrientIds.VitaminE, 1000),
        ("vitamin-k_100g", NutrientIds.VitaminK, 1_000_000),
        ("vitamin-b6_100g", NutrientIds.VitaminB6, 1000),
        ("vitamin-b12_100g", NutrientIds.VitaminB12, 1_000_000),
        ("folates_100g", NutrientIds.Folate, 1_000_000),
        ("alcohol_100g", NutrientIds.Alcohol, 0.789 * 1), // % vol → g per 100 ml (density of ethanol)
    ];

    public async Task<BarcodeLookup> LookupAsync(string normalizedBarcode, CancellationToken ct = default)
    {
        try
        {
            using var response = await http.GetAsync($"api/v2/product/{normalizedBarcode}.json?fields={Fields}", ct);
            if (response.StatusCode == HttpStatusCode.TooManyRequests) return BarcodeLookup.Failed(ProviderFailure.RateLimited);
            if ((int)response.StatusCode >= 500) return BarcodeLookup.Failed(ProviderFailure.Network);
            // OFF answers an unknown code with 404 and {"status":0}: a real "not found".
            if (response.StatusCode == HttpStatusCode.NotFound) return BarcodeLookup.NotFound;
            if (!response.IsSuccessStatusCode) return BarcodeLookup.Failed(ProviderFailure.BadResponse);
            await using var stream = await response.Content.ReadAsStreamAsync(ct);
            using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: ct);
            return Parse(doc.RootElement, normalizedBarcode) is { } food ? BarcodeLookup.Found(food) : BarcodeLookup.NotFound;
        }
        catch (TaskCanceledException) when (!ct.IsCancellationRequested)
        {
            logger.LogWarning("Open Food Facts lookup timed out for {Barcode}", normalizedBarcode);
            return BarcodeLookup.Failed(ProviderFailure.Timeout);
        }
        catch (HttpRequestException ex)
        {
            logger.LogWarning(ex, "Open Food Facts unreachable for {Barcode}", normalizedBarcode);
            return BarcodeLookup.Failed(ProviderFailure.Network);
        }
        catch (JsonException ex)
        {
            logger.LogWarning(ex, "Open Food Facts sent an unreadable response for {Barcode}", normalizedBarcode);
            return BarcodeLookup.Failed(ProviderFailure.BadResponse);
        }
    }

    public static Food? Parse(JsonElement root, string barcode)
    {
        if (root.TryGetProperty("status", out var status) && status.ValueKind == JsonValueKind.Number && status.GetInt32() == 0) return null;
        if (!root.TryGetProperty("product", out var product)) return null;
        if (!product.TryGetProperty("nutriments", out var n) || n.ValueKind != JsonValueKind.Object) return null;

        var nutrients = new Dictionary<int, double>();
        var kcal = Number(n, "energy-kcal_100g");
        if (kcal is null && Number(n, "energy_100g") is { } kj) kcal = kj / 4.184; // energy_100g is kJ
        if (kcal is null) return null;
        nutrients[NutrientIds.Energy] = Math.Round(kcal.Value, 1);

        foreach (var (key, id, factor) in Map)
            if (Number(n, key) is { } v) nutrients[id] = Math.Round(v * factor, 4);

        if (!nutrients.ContainsKey(NutrientIds.Sodium) && Number(n, "salt_100g") is { } salt)
            nutrients[NutrientIds.Sodium] = Math.Round(salt / 2.5 * 1000, 2); // salt = sodium × 2.5

        var name = Str(product, "product_name_en") ?? Str(product, "product_name") ?? Str(product, "generic_name");
        if (string.IsNullOrWhiteSpace(name)) name = $"Product {barcode}";
        var brand = Str(product, "brands")?.Split(',')[0].Trim();

        var portions = new List<FoodPortion>();
        var servingQty = Number(product, "serving_quantity");
        if (servingQty is > 0)
            portions.Add(new FoodPortion($"serving ({Str(product, "serving_size") ?? $"{servingQty:0.#} g"})", servingQty.Value));

        var category = product.TryGetProperty("categories_tags", out var cats) && cats.ValueKind == JsonValueKind.Array
            ? cats.EnumerateArray().Select(c => c.GetString()).LastOrDefault(c => c is not null && c.StartsWith("en:"))?[3..].Replace('-', ' ')
            : null;

        return new Food(name.Trim(), FoodSource.OpenFoodFacts, new NutrientProfile(nutrients),
            sourceId: barcode, brand: brand, barcode: barcode, category: category is null ? null : CultureInfo.InvariantCulture.TextInfo.ToTitleCase(category),
            portions: portions);
    }

    private static double? Number(JsonElement e, string name)
    {
        if (!e.TryGetProperty(name, out var v)) return null;
        return v.ValueKind switch
        {
            JsonValueKind.Number => v.GetDouble(),
            JsonValueKind.String when double.TryParse(v.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var d) => d,
            _ => null,
        };
    }

    private static string? Str(JsonElement e, string name) =>
        e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(v.GetString()) ? v.GetString() : null;
}
