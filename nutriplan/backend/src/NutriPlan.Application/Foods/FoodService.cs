using NutriPlan.Application.Abstractions;
using NutriPlan.Application.Common;
using NutriPlan.Domain.Foods;
using NutriPlan.Domain.Nutrients;
using NutriPlan.Domain.Parsing;
using NutriPlan.Domain.Units;

namespace NutriPlan.Application.Foods;

/// <summary>A food match for a piece of text, with the amount already converted to grams when possible.</summary>
public sealed record FoodMatchDto(
    FoodSummaryDto Food,
    double Score,
    QuantityDto Quantity,
    NutritionDto? Nutrition);

public sealed record FoodMatchGroupDto(
    string Text,
    double? Amount,
    string? Unit,
    string FoodQuery,
    IReadOnlyList<FoodMatchDto> Matches);

public sealed record CreateFoodRequest(
    string Name,
    string? Brand,
    string? Barcode,
    /// <summary>Label serving size in grams; nutrients below are for this serving.</summary>
    double ServingGrams,
    string? ServingDescription,
    Dictionary<int, double> NutrientsPerServing);

public sealed class FoodService(
    IFoodRepository foods,
    IEnumerable<IBarcodeProvider> barcodeProviders,
    IUnitOfWork uow)
{
    public const int DefaultSearchLimit = 25;

    public async Task<IReadOnlyList<FoodSummaryDto>> SearchAsync(string query, int limit = DefaultSearchLimit, CancellationToken ct = default)
    {
        var ranked = await SearchRankedAsync(query, limit, ct);
        return ranked.Select(r => FoodSummaryDto.From(r.Food)).ToList();
    }

    public async Task<IReadOnlyList<RankedFood>> SearchRankedAsync(string query, int limit, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(query)) return [];
        var rows = await foods.SearchAsync(query.Trim(), Math.Max(limit * 12, 300), ct);
        // Foundation data has several samples under one name; keep the best-ranked one.
        return FoodRanker.Rank(query, rows)
            .DistinctBy(r => (r.Food.Name.ToLowerInvariant(), r.Food.Brand?.ToLowerInvariant()))
            .Take(limit)
            .ToList();
    }

    public async Task<FoodSummaryDto> GetAsync(Guid id, CancellationToken ct = default) =>
        FoodSummaryDto.From(await foods.GetAsync(id, ct) ?? throw new NotFoundException($"Food {id} not found."));

    /// <summary>
    /// Barcode lookup: local database first (USDA branded import, your own foods, earlier scans),
    /// then each external provider in order. External hits are saved locally so the next scan is instant.
    /// </summary>
    public async Task<FoodSummaryDto?> LookupBarcodeAsync(string barcode, CancellationToken ct = default)
    {
        var normalized = Food.NormalizeBarcode(barcode) ?? throw new ValidationException("Barcode has no digits.");
        var local = await foods.FindByBarcodeAsync(normalized, ct);
        if (local is not null) return FoodSummaryDto.From(local);

        foreach (var provider in barcodeProviders)
        {
            var found = await provider.LookupAsync(normalized, ct);
            if (found is null) continue;
            foods.Add(found);
            await uow.SaveChangesAsync(ct);
            return FoodSummaryDto.From(found);
        }
        return null;
    }

    /// <summary>Creates a food from a nutrition label (values per serving are converted to per 100 g).</summary>
    public async Task<FoodSummaryDto> CreateCustomAsync(CreateFoodRequest request, CancellationToken ct = default)
    {
        if (request.ServingGrams <= 0) throw new ValidationException("Serving size must be greater than 0 g.");
        if (!request.NutrientsPerServing.ContainsKey(NutrientIds.Energy)) throw new ValidationException("Calories are required.");

        var per100 = new NutrientProfile(request.NutrientsPerServing).Scale(100 / request.ServingGrams).Rounded();
        var portions = new List<FoodPortion> { new(request.ServingDescription ?? "serving", request.ServingGrams) };
        var food = new Food(request.Name, FoodSource.User, per100, brand: request.Brand, barcode: request.Barcode, portions: portions);
        foods.Add(food);
        await uow.SaveChangesAsync(ct);
        return FoodSummaryDto.From(food);
    }

    public async Task<FoodSummaryDto> VerifyAsync(Guid id, CancellationToken ct = default)
    {
        var food = await foods.GetAsync(id, ct) ?? throw new NotFoundException($"Food {id} not found.");
        food.MarkVerified();
        await uow.SaveChangesAsync(ct);
        return FoodSummaryDto.From(food);
    }

    public async Task<QuantityDto> ResolveQuantityAsync(Guid foodId, double amount, string? unit, CancellationToken ct = default)
    {
        var food = await foods.GetAsync(foodId, ct) ?? throw new NotFoundException($"Food {foodId} not found.");
        return QuantityDto.From(QuantityResolver.Resolve(food, amount, unit));
    }

    /// <summary>"half a pound of chicken breast" → ranked foods, each with grams and nutrition for that amount.</summary>
    public Task<FoodMatchGroupDto> MatchTextAsync(string text, int limit = 8, CancellationToken ct = default)
    {
        var parsed = QuantityTextParser.Parse(text);
        return MatchAsync(text, parsed.FoodText, parsed.Amount, parsed.Unit, cookedState: null, limit, ct);
    }

    public async Task<FoodMatchGroupDto> MatchAsync(
        string originalText, string foodQuery, double? amount, string? unit, string? cookedState, int limit, CancellationToken ct)
    {
        var query = foodQuery;
        if (cookedState is not null && !query.Contains(cookedState, StringComparison.OrdinalIgnoreCase))
            query = $"{query} {cookedState}";

        var ranked = await SearchRankedAsync(query, limit, ct);
        var matches = ranked.Select(r =>
        {
            var q = QuantityResolver.Resolve(r.Food, amount ?? 1, amount is null ? null : unit);
            if (amount is null && !q.IsResolved)
                q = new ResolvedQuantity(100, ResolutionMethod.Mass, "No amount given, showing 100 g.");
            var nutrition = q.Grams is null ? null : NutritionDto.From(r.Food.NutrientsFor(q.Grams.Value));
            return new FoodMatchDto(FoodSummaryDto.From(r.Food), Math.Round(r.Score, 1), QuantityDto.From(q), nutrition);
        }).ToList();

        return new FoodMatchGroupDto(originalText, amount, unit, foodQuery, matches);
    }
}
