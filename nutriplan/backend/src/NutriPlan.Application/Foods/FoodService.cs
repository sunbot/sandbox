using NutriPlan.Application.Abstractions;
using NutriPlan.Application.Common;
using NutriPlan.Domain.Foods;
using NutriPlan.Domain.Nutrients;
using NutriPlan.Domain.Parsing;
using NutriPlan.Domain.Units;

namespace NutriPlan.Application.Foods;

/// <summary>A food match for a piece of text, with the amount already converted to grams when possible.</summary>
/// <param name="State">Raw, Cooked or Unspecified, from the matched food's name.</param>
/// <param name="Requested">The state the person asked for ("grilled", "raw"), or null if they didn't say.</param>
/// <param name="Note">Set when the state wasn't specified and a raw/cooked counterpart would change the calories noticeably.</param>
/// <param name="OtherFoodId">That counterpart (raw if this is cooked, and the reverse), so it can be chosen in one tap.</param>
public sealed record PreparationDto(string State, string? Requested, string? Note, Guid? OtherFoodId, string? OtherState);

/// <param name="Confidence">0–1 from the ranking score; below 0.5 the match deserves a look.</param>
/// <summary>Food when found; otherwise Failure says whether a provider couldn't be reached (null = genuinely not found).</summary>
public sealed record BarcodeResult(FoodSummaryDto? Food, ProviderFailure? Failure);

public sealed record FoodMatchDto(
    FoodSummaryDto Food,
    double Score,
    QuantityDto Quantity,
    NutritionDto? Nutrition,
    double Confidence,
    PreparationDto? Preparation = null);

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

    /// <summary>Everyday words → how USDA names them. Only whole-query matches; add your own.</summary>
    public static readonly Dictionary<string, string> Synonyms = new(StringComparer.OrdinalIgnoreCase)
    {
        ["toast"] = "bread toasted",
        ["oj"] = "orange juice",
        ["pb"] = "peanut butter",
        ["coffee"] = "coffee brewed",
        ["black coffee"] = "coffee brewed",
        ["tea"] = "tea brewed",
        ["water"] = "water tap",
        ["egg"] = "egg whole",
        ["eggs"] = "egg whole",
    };

    public async Task<IReadOnlyList<FoodSummaryDto>> SearchAsync(string query, int limit = DefaultSearchLimit, CancellationToken ct = default)
    {
        var ranked = await SearchRankedAsync(query, limit, ct);
        return ranked.Select(r => FoodSummaryDto.From(r.Food)).ToList();
    }

    /// <param name="dedupe">Collapse entries with the same name (for display). Matching code passes false so it can
    /// try each entry's measures.</param>
    public async Task<IReadOnlyList<RankedFood>> SearchRankedAsync(string query, int limit, CancellationToken ct = default, bool dedupe = true, bool useHistory = true, bool assumeCookedStaples = true)
    {
        if (string.IsNullOrWhiteSpace(query)) return [];
        // Everyday words USDA names differently ("toast" → toasted bread), same as Ask.
        if (Synonyms.TryGetValue(query.Trim(), out var synonym)) query = synonym;
        var rows = await foods.SearchAsync(query.Trim(), Math.Max(limit * 12, 300), ct);
        if (!dedupe) return FoodRanker.Rank(query, rows, useHistory, assumeCookedStaples).Take(limit).ToList();
        // Several entries can share a name (Foundation samples, SR Legacy, Survey). Keep one per name, preferring
        // one that has household measures (cup, slice…) so amounts like "1 cup" can be converted.
        return FoodRanker.Rank(query, rows, useHistory, assumeCookedStaples)
            .GroupBy(r => (r.Food.Name.ToLowerInvariant(), r.Food.Brand?.ToLowerInvariant()))
            .Select(g =>
            {
                var best = g.First();
                var withPortions = g.FirstOrDefault(r => r.Food.Portions.Count > 0);
                return withPortions is not null && best.Food.Portions.Count == 0 ? withPortions with { Score = best.Score } : best;
            })
            .OrderByDescending(r => r.Score)
            .Take(limit)
            .ToList();
    }

    public async Task<FoodSummaryDto> GetAsync(Guid id, CancellationToken ct = default) =>
        FoodSummaryDto.From(await foods.GetAsync(id, ct) ?? throw new NotFoundException($"Food {id} not found."));

    /// <summary>
    /// Barcode lookup: local database first (USDA branded import, your own foods, earlier scans),
    /// then each external provider in order. External hits are saved locally so the next scan is instant.
    /// </summary>
    /// <summary>
    /// Local foods first, then each barcode provider in order. "Not found" only when every provider answered that it doesn't
    /// know the code; if any provider couldn't be reached, the result is a temporary failure so the app offers a retry.
    /// </summary>
    public async Task<BarcodeResult> LookupBarcodeAsync(string barcode, CancellationToken ct = default)
    {
        var normalized = Food.NormalizeBarcode(barcode) ?? throw new ValidationException("That barcode has no digits. Scan it again.");
        if (!Food.IsPlausibleBarcode(normalized)) throw new ValidationException("That doesn't look like a product barcode. Scan it again, or enter the label by hand.");
        var local = await foods.FindByBarcodeAsync(normalized, ct);
        if (local is not null) return new(FoodSummaryDto.From(local), null);

        ProviderFailure? failure = null;
        foreach (var provider in barcodeProviders)
        {
            var result = await provider.LookupAsync(normalized, ct);
            if (result is { Status: BarcodeLookupStatus.Found, Food: { } found })
            {
                // Two providers can know the same product under differently formatted codes: keep the first one saved.
                if (await foods.FindByBarcodeAsync(found.Barcode ?? normalized, ct) is { } existing) return new(FoodSummaryDto.From(existing), null);
                foods.Add(found);
                await uow.SaveChangesAsync(ct);
                return new(FoodSummaryDto.From(found), null);
            }
            if (result.Status == BarcodeLookupStatus.Failed) failure ??= result.Failure;
        }
        return new(null, failure);
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

    /// <summary>
    /// Raw vs cooked for one match. Only flagged when no state was asked for and the other state is also a real option whose
    /// calories per 100 g differ by a quarter or more — i.e. when guessing wrong would materially change the log.
    /// No weights are ever converted between states.
    /// </summary>
    private static PreparationDto PreparationFor(Food food, PreparationState requested, bool cookedStaple, IReadOnlyList<RankedFood> candidates)
    {
        var state = FoodPreparation.StateOf(food.Name);
        var req = requested == PreparationState.Unspecified ? null : requested.ToString();
        if (state == PreparationState.Unspecified || !FoodPreparation.CookingMattersFor(food.Name)) return new(state.ToString(), req, null, null, null);

        var other = state == PreparationState.Raw ? PreparationState.Cooked : PreparationState.Raw;
        var mine = FoodPreparation.Identity(food.Name);
        var counterpart = candidates
            .Where(c => c.Food.Id != food.Id && FoodPreparation.StateOf(c.Food.Name) == other)
            .Select(c => (c.Food, Sim: FoodPreparation.Similarity(mine, FoodPreparation.Identity(c.Food.Name))))
            .Where(x => x.Sim >= 0.6)
            .OrderByDescending(x => x.Sim)
            .Select(x => x.Food)
            .FirstOrDefault();
        if (counterpart is null)
        {
            // Rice, pasta, beans with no state said: cooked was assumed, so say so even when no dry entry is in the results.
            var assumed = requested == PreparationState.Unspecified && cookedStaple && state == PreparationState.Cooked
                ? $"Assumed cooked ({food.NutrientsPer100g.Calories:0} kcal per 100 g). If you weighed it raw or dry, search for the dry version — it has far more calories per gram."
                : null;
            return new(state.ToString(), req, assumed, null, null);
        }

        var a = food.NutrientsPer100g.Calories;
        var b = counterpart.NutrientsPer100g.Calories;
        var material = Math.Max(a, b) > 0 && Math.Abs(a - b) / Math.Max(a, b) >= 0.25;
        string? note = null;
        if (requested == PreparationState.Unspecified && material)
        {
            note = state == PreparationState.Raw
                ? $"Raw weight ({a:0} kcal per 100 g). If it was cooked, choose the cooked version ({b:0} kcal per 100 g)."
                : $"Assumed cooked ({a:0} kcal per 100 g). If you weighed it raw or dry, choose that version ({b:0} kcal per 100 g).";
        }
        return new(state.ToString(), req, note, counterpart.Id, other.ToString());
    }

    /// <summary>Same scale as recipe ingredient matching: 0 at score 20, 1 at score 80.</summary>
    public static double MatchConfidence(double score) => Math.Round(Math.Clamp((score - 20) / 60, 0, 1), 2);

    public async Task<FoodMatchGroupDto> MatchAsync(
        string originalText, string foodQuery, double? amount, string? unit, string? cookedState, int limit, CancellationToken ct)
    {
        var query = Synonyms.TryGetValue(foodQuery.Trim(), out var synonym) ? synonym : foodQuery;
        if (cookedState is not null && !query.Contains(cookedState, StringComparison.OrdinalIgnoreCase))
            query = $"{query} {cookedState}";

        var ranked = await SearchRankedAsync(query, limit, ct);
        var queryTokens = FoodRanker.Tokens(query).ToList();
        var requested = FoodPreparation.Requested(queryTokens);
        var cookedStaple = FoodPreparation.IsCookedStaple(queryTokens);
        var matches = ranked.Select(r =>
        {
            // No amount: offer the food's standard USDA portion as an assumption to confirm. If there isn't one,
            // the amount stays unknown — never a made-up default weight.
            var q = QuantityResolver.Resolve(r.Food, amount ?? 1, amount is null ? null : unit);
            if (amount is null && !q.IsResolved)
                q = new ResolvedQuantity(null, ResolutionMethod.Unresolved, "No amount given. Choose how much.");
            // A count word that isn't a portion ("2 pieces") falls back to the food's standard item: shown as an assumption.
            var assumedItem = amount is not null && q.Method == ResolutionMethod.DefaultPortion && !string.IsNullOrWhiteSpace(unit);
            var nutrition = q.Grams is null ? null : NutritionDto.From(r.Food.NutrientsFor(q.Grams.Value));
            return new FoodMatchDto(FoodSummaryDto.From(r.Food), Math.Round(r.Score, 1), QuantityDto.From(q, amountGiven: amount is not null && !assumedItem),
                nutrition, MatchConfidence(r.Score), PreparationFor(r.Food, requested, cookedStaple, ranked));
        }).ToList();

        return new FoodMatchGroupDto(originalText, amount, unit, foodQuery, matches);
    }
}
