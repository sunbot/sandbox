using NutriPlan.Application.Abstractions;
using NutriPlan.Application.Common;
using NutriPlan.Domain.Foods;
using NutriPlan.Domain.Nutrients;

namespace NutriPlan.Application.Foods;

/// <summary>One packaged product in search results. Per-serving numbers only when the label gives a serving size.</summary>
public sealed record BrandedFoodDto(
    string Source,
    string SourceId,
    string Name,
    string? Brand,
    string? Barcode,
    string BaseUnit,
    string? ServingDescription,
    double? ServingAmount,
    NutritionDto Per100,
    NutritionDto? PerServing,
    bool CaloriesCalculated,
    bool CaloriesMissing,
    Guid? LocalFoodId,
    DateOnly? LabelDate);

/// <param name="Failure">Set when the provider couldn't answer (Timeout, RateLimited, Network, BadResponse, NotConfigured).</param>
public sealed record BrandedResultsDto(IReadOnlyList<BrandedFoodDto> Results, string? Failure, string Attribution);

/// <summary>
/// Branded/packaged food search through an external provider (USDA FoodData Central). Results aren't stored until you
/// open or log one; then the product is saved once under its provider id and reused. Local search never waits on this.
/// </summary>
public sealed class BrandedFoodService(IFoodRepository foods, IBrandedFoodProvider provider, RemoteSearchCache cache, IUnitOfWork uow)
{
    public const int MaxQueryLength = 100;
    public const string Attribution = "Branded products from USDA FoodData Central.";
    /// <summary>Manufacturer labels change; a cached product older than this is refreshed when you open it.</summary>
    public static readonly TimeSpan RefreshAfter = TimeSpan.FromDays(90);

    public async Task<BrandedResultsDto> SearchAsync(string query, int limit = 20, CancellationToken ct = default)
    {
        var q = (query ?? "").Trim();
        if (q.Length < 2) return new([], null, Attribution);
        if (q.Length > MaxQueryLength) throw new ValidationException($"Search for {MaxQueryLength} characters or fewer.");
        if (!provider.IsConfigured) return new([], "NotConfigured", Attribution);
        limit = Math.Clamp(limit, 1, 40);

        var key = string.Join(' ', FoodRanker.Tokens(q));
        var search = await cache.GetOrRunAsync(key, () => provider.SearchAsync(q, 50, ct), r => r.Failure is null);

        var ranked = Rank(q, search.Products).Take(limit).ToList();
        var results = new List<BrandedFoodDto>(ranked.Count);
        foreach (var p in ranked)
        {
            var local = await foods.FindBySourceAsync(p.Source, p.SourceId, ct);
            var (done, calculated) = Complete(p);
            results.Add(ToDto(done, calculated, local?.Id));
        }
        return new(results, search.Failure?.ToString(), Attribution);
    }

    /// <summary>Saves a product (once) so it can be logged, or returns the saved copy, refreshing it if it's stale.</summary>
    public async Task<FoodSummaryDto> AddAsync(string sourceId, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(sourceId) || sourceId.Length > 40 || !sourceId.All(char.IsDigit)) throw new ValidationException("Unknown product.");
        var existing = await foods.FindBySourceAsync(FoodSource.UsdaBranded, sourceId, ct);
        if (existing is not null)
        {
            if (DateTimeOffset.UtcNow - existing.UpdatedAt > RefreshAfter && existing.Quality != DataQuality.Verified)
            {
                var fresh = await provider.GetAsync(sourceId, ct);
                if (fresh.Product is { } p)
                {
                    var (done, calculated) = Complete(p);
                    existing.RefreshFromSource(done.Name, done.Brand, done.Per100, done.Portions, done.Basis);
                    if (calculated) existing.AddQualityNote(CalculatedNote);
                    await uow.SaveChangesAsync(ct);
                }
                // A failed refresh keeps the saved label: it's still the best we have.
            }
            return FoodSummaryDto.From(existing);
        }

        var fetched = await provider.GetAsync(sourceId, ct);
        if (fetched.Product is null)
            throw fetched.Failure is { } why ? new ProviderUnavailableException(why) : new NotFoundException("That product is no longer in the USDA database.");
        var food = ToFood(fetched.Product);
        // Scanned earlier under its barcode from another source? Keep that one rather than adding a twin.
        if (food.Barcode is { } code && await foods.FindByBarcodeAsync(code, ct) is { } twin) return FoodSummaryDto.From(twin);
        foods.Add(food);
        await uow.SaveChangesAsync(ct);
        return FoodSummaryDto.From(food);
    }

    public const string CalculatedNote = "Calories calculated from protein, carbs and fat (4/4/9 kcal per g) because the label didn't list them.";

    /// <summary>
    /// The label didn't list calories but did list protein, carbs and fat: calories are calculated from them (a
    /// deterministic 4/4/9 calculation, plus 7 kcal/g alcohol when listed) and the food says so. Otherwise left unknown.
    /// </summary>
    public static (BrandedProduct Product, bool Calculated) Complete(BrandedProduct p)
    {
        var n = p.Per100;
        if (n.Has(NutrientIds.Energy) || !n.Has(NutrientIds.Protein) || !n.Has(NutrientIds.Carbohydrate) || !n.Has(NutrientIds.Fat)) return (p, false);
        var kcal = n.Get(NutrientIds.Protein) * 4 + n.Get(NutrientIds.Carbohydrate) * 4 + n.Get(NutrientIds.Fat) * 9 + n.Get(NutrientIds.Alcohol) * 7;
        var amounts = n.Amounts.ToDictionary(kv => kv.Key, kv => kv.Value);
        amounts[NutrientIds.Energy] = Math.Round(kcal, 1);
        return (p with { Per100 = new NutrientProfile(amounts) }, true);
    }

    public static Food ToFood(BrandedProduct raw)
    {
        var (p, calculated) = Complete(raw);
        var food = new Food(p.Name, p.Source, p.Per100, p.SourceId, p.Brand, p.Barcode, null, p.Portions, p.Basis);
        if (calculated) food.AddQualityNote(CalculatedNote);
        return food;
    }

    /// <summary>
    /// The provider's own order is weak for brand searches, so results are re-ranked: every search word should appear
    /// in the brand or name (brand words count double), fewer extra words is better, and products with calories beat
    /// those without. Duplicates (same barcode, or same brand and name) are collapsed. Products matching no search word drop out.
    /// </summary>
    public static IEnumerable<BrandedProduct> Rank(string query, IEnumerable<BrandedProduct> products)
    {
        var q = FoodRanker.Tokens(query).Distinct().ToList();
        if (q.Count == 0) return [];
        var seenCodes = new HashSet<string>();
        var seenNames = new HashSet<string>();
        var scored = new List<(BrandedProduct P, double Score, int Order)>();
        var order = 0;
        foreach (var p in products)
        {
            order++;
            if (p.Barcode is { } code && !seenCodes.Add(code.TrimStart('0'))) continue;
            if (!seenNames.Add($"{p.Brand}|{p.Name}".ToLowerInvariant())) continue;
            var brand = FoodRanker.Tokens(p.Brand ?? "").ToHashSet();
            var name = FoodRanker.Tokens(p.Name).ToHashSet();
            var matched = q.Count(t => brand.Contains(t) || name.Contains(t));
            if (matched == 0) continue;
            var score = 100.0 * matched / q.Count
                + 15 * q.Count(brand.Contains)                          // the brand you typed
                + (matched == q.Count ? 25 : 0)                         // every word found
                - 2 * Math.Max(0, name.Count - q.Count)                 // plainer names first
                + (p.Per100.Has(NutrientIds.Energy) ? 5 : 0);
            scored.Add((p, score, order));
        }
        return scored.OrderByDescending(s => s.Score).ThenBy(s => s.Order).Select(s => s.P);
    }

    public static BrandedFoodDto ToDto(BrandedProduct p, bool calculated, Guid? localId)
    {
        var serving = p.Portions.FirstOrDefault();
        var perServing = serving is { GramWeight: > 0 } ? NutritionDto.From(p.Per100.ForGrams(serving.GramWeight)) : null;
        var unit = p.Basis == NutrientBasis.Volume ? "ml" : "g";
        string? servingText = serving is null ? null : $"{Amount(serving.Amount)} {serving.Description} ({serving.GramWeight:0.#} {unit})".Trim();
        return new(p.Source.ToString(), p.SourceId, p.Name, p.Brand, p.Barcode, unit, servingText, serving?.GramWeight,
            NutritionDto.From(p.Per100), perServing, calculated, !p.Per100.Has(NutrientIds.Energy), localId, p.LabelDate);
    }

    private static string Amount(double a) => a == 1 ? "1" : a.ToString("0.##");
}

/// <summary>An external food database couldn't answer (temporary). Mapped to 503 with the reason.</summary>
public sealed class ProviderUnavailableException(ProviderFailure failure) : Exception($"The food database is unavailable ({failure}).")
{
    public ProviderFailure Failure { get; } = failure;
}
