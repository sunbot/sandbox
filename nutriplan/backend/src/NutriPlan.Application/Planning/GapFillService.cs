using NutriPlan.Application.Abstractions;
using NutriPlan.Application.Common;
using NutriPlan.Application.Foods;
using NutriPlan.Domain.Diary;
using NutriPlan.Domain.Foods;
using NutriPlan.Domain.Nutrients;
using NutriPlan.Domain.Planning;
using NutriPlan.Domain.Recipes;

namespace NutriPlan.Application.Planning;

public sealed record GapItemDto(string Kind, Guid? FoodId, Guid? RecipeId, string Name, double Amount, string Unit, NutritionDto Nutrition);

public sealed record GapSuggestionDto(IReadOnlyList<GapItemDto> Items, NutritionDto Adds, NutritionDto RemainingAfter, string Summary);

public sealed record GapReportDto(
    DateOnly Date,
    NutritionDto Remaining,
    IReadOnlyList<NutrientProgressGap> Gaps,
    IReadOnlyList<GapSuggestionDto> Suggestions);

public sealed record NutrientProgressGap(int NutrientId, string Name, string Unit, double Remaining, double Target, string Kind);

public sealed record GapFillRequest(DateOnly Date, bool IncludePlanned = true, bool IncludeMicronutrients = true, int MaxItems = 3, bool RecipesOnly = false);

/// <summary>
/// "What can I add to round out today?" Works out what's left of the day's targets and asks the
/// <see cref="GapFiller"/> to choose from foods you actually eat, your favourite recipes, your pantry,
/// and a short list of nutrient-dense staples (so it still works on day one).
/// </summary>
public sealed class GapFillService(
    ITargetsRepository targetsRepo,
    IDiaryRepository diary,
    IPlanRepository plan,
    IRecipeRepository recipes,
    IPantryRepository pantry,
    IFoodRepository foods,
    FoodService foodService)
{
    /// <summary>Searched once each (best match) to seed suggestions when there's little history. Edit freely.</summary>
    public static readonly string[] StarterFoods =
    [
        "yogurt greek plain nonfat", "almonds", "egg whole raw", "banana raw", "apples raw with skin",
        "cottage cheese lowfat", "oats", "peanut butter smooth", "lentils mature seeds cooked boiled",
        "chicken broilers or fryers breast meat only cooked roasted", "salmon atlantic farmed cooked", "spinach raw",
        "milk lowfat 1%", "cheese cheddar", "avocados raw all commercial", "blueberries raw", "carrots raw",
        "broccoli raw", "tuna light canned in water drained", "beans black mature seeds cooked boiled",
    ];

    public async Task<GapReportDto> SuggestAsync(GapFillRequest request, CancellationToken ct = default)
    {
        var targets = await targetsRepo.GetAsync(ct);
        var date = request.Date;

        var eaten = NutrientProfile.Sum((await diary.GetRangeAsync(date, date, ct)).Select(e => e.Item.Nutrients));
        var planned = request.IncludePlanned
            ? NutrientProfile.Sum((await plan.GetRangeAsync(date, date, ct)).Where(p => p.Status == PlanStatus.Planned).Select(p => p.Item.Nutrients))
            : NutrientProfile.Empty;
        var have = eaten + planned;

        var gapTargets = BuildTargets(targets, have, request.IncludeMicronutrients);
        var candidates = await BuildCandidatesAsync(request.RecipesOnly, ct);
        var suggestions = GapFiller.Suggest(gapTargets, candidates, new GapFillOptions(MaxItems: Math.Clamp(request.MaxItems, 1, 4)));

        var remaining = new NutrientProfile(gapTargets.ToDictionary(t => t.NutrientId, t => t.Remaining));
        var gaps = gapTargets
            .Where(t => t.Kind == TargetKind.Goal ? t.Remaining > t.DailyTarget * 0.1 : t.Remaining < 0)
            .Select(t =>
            {
                var def = NutrientCatalog.Get(t.NutrientId);
                return new NutrientProgressGap(t.NutrientId, def.Name, def.Unit, Math.Round(t.Remaining, 2), t.DailyTarget, t.Kind.ToString());
            })
            .ToList();

        return new GapReportDto(date, NutritionDto.From(remaining), gaps, suggestions.Select(s => ToDto(s, gapTargets)).ToList());
    }

    public static IReadOnlyList<GapTarget> BuildTargets(NutritionTargets targets, NutrientProfile have, bool includeMicros)
    {
        var list = new List<GapTarget>();
        void Add(int id, double weight)
        {
            if (targets.TargetFor(id) is not { } daily || daily <= 0) return;
            list.Add(new GapTarget(id, daily - have.Get(id), daily, targets.KindFor(id), weight));
        }

        Add(NutrientIds.Energy, 4);
        Add(NutrientIds.Protein, 3);
        Add(NutrientIds.Carbohydrate, 1);
        Add(NutrientIds.Fat, 1);
        if (includeMicros)
        {
            foreach (var id in targets.EffectiveFocusNutrients.Distinct())
            {
                if (list.Any(t => t.NutrientId == id)) continue;
                Add(id, id == NutrientIds.Fiber ? 1.5 : targets.KindFor(id) == TargetKind.Limit ? 1 : 0.4);
            }
        }
        return list;
    }

    private async Task<List<GapCandidate>> BuildCandidatesAsync(bool recipesOnly, CancellationToken ct)
    {
        var candidates = new Dictionary<string, GapCandidate>();

        // 1) Recipes you like (favourites, or well-matched recipes you've logged).
        var frequent = await diary.GetFrequentItemsAsync(days: 90, limit: 60, ct);
        var recipeIds = frequent.Where(f => f.Item.RecipeId is not null).Select(f => f.Item.RecipeId!.Value).ToHashSet();
        var allRecipes = await recipes.ListAsync(ct: ct);
        foreach (var r in allRecipes.Where(r => (r.IsFavorite || recipeIds.Contains(r.Id)) && r.NutritionCoverage >= 0.8 && r.NutritionPerServing.Calories > 0))
            candidates[$"r:{r.Id}"] = RecipeCandidate(r, r.IsFavorite ? 0.1 : 0.05);

        if (recipesOnly)
        {
            foreach (var r in allRecipes.Where(r => r.NutritionCoverage >= 0.8 && r.NutritionPerServing.Calories > 0).Take(80))
                candidates.TryAdd($"r:{r.Id}", RecipeCandidate(r, 0));
            return candidates.Values.ToList();
        }

        // 2) Foods you log, at roughly the amount you usually eat.
        var foodFreq = frequent.Where(f => f.Item.FoodId is not null && f.Item.Grams is > 0).ToList();
        var foodMap = await foods.GetManyAsync(foodFreq.Select(f => f.Item.FoodId!.Value), ct);
        foreach (var f in foodFreq)
        {
            if (!foodMap.TryGetValue(f.Item.FoodId!.Value, out var food)) continue;
            candidates.TryAdd($"f:{food.Id}", FoodCandidate(food, f.Item.Grams!.Value, 0.08));
        }

        // 3) What's in the pantry.
        var pantryFoodIds = (await pantry.ListAsync(ct)).Where(p => p.FoodId is not null && !p.IsStaple).Select(p => p.FoodId!.Value).ToList();
        foreach (var food in (await foods.GetManyAsync(pantryFoodIds, ct)).Values)
            candidates.TryAdd($"f:{food.Id}", FoodCandidate(food, TypicalGrams(food), 0.1));

        // 4) Staples so there's always something to suggest.
        if (candidates.Count < 25)
        {
            foreach (var query in StarterFoods)
            {
                var best = (await foodService.SearchRankedAsync(query, 1, ct)).FirstOrDefault();
                if (best is null) continue;
                candidates.TryAdd($"f:{best.Food.Id}", FoodCandidate(best.Food, TypicalGrams(best.Food), 0));
            }
        }

        return candidates.Values.Where(c => c.NutrientsPerStep.Calories > 0).ToList();
    }

    private static GapCandidate RecipeCandidate(Recipe r, double bonus) =>
        new($"r:{r.Id}", ItemKind.Recipe, null, r.Id, r.Name, r.NutritionPerServing.Scale(0.5), 0.5, "serving", 1, 4, bonus);

    /// <summary>Quantities move in ~quarter-portion steps up to 1.5 portions (and never more than 300 g).</summary>
    private static GapCandidate FoodCandidate(Food food, double usualGrams, double bonus)
    {
        usualGrams = Math.Clamp(usualGrams, 10, 250);
        var step = Math.Max(5, Math.Round(usualGrams / 4 / 5) * 5);
        var maxSteps = (int)Math.Clamp(Math.Floor(Math.Min(usualGrams * 1.5, 300) / step), 1, 16);
        return new GapCandidate($"f:{food.Id}", ItemKind.Food, food.Id, null, food.DisplayName, food.NutrientsFor(step), step, "g", 1, maxSteps, bonus);
    }

    /// <summary>
    /// A realistic single serving: the FDA reference amount ("NLEA serving") when USDA lists it, else a labelled
    /// serving, the food's natural item ("1 banana"), a cup, or 100 g.
    /// </summary>
    public static double TypicalGrams(Food food)
    {
        var p = food.Portions;
        var nlea = p.FirstOrDefault(x => x.Description.Contains("NLEA", StringComparison.OrdinalIgnoreCase))
                   ?? p.FirstOrDefault(x => x.Description.StartsWith("serving", StringComparison.OrdinalIgnoreCase));
        if (nlea is { GramsPerUnit: >= 5 and <= 300 }) return nlea.GramsPerUnit;

        var item = Domain.Units.QuantityResolver.Resolve(food, 1, null);
        if (item is { Method: Domain.Units.ResolutionMethod.DefaultPortion, Grams: >= 10 and <= 300 }) return item.Grams.Value;

        var cup = Domain.Units.QuantityResolver.Resolve(food, 1, "cup");
        if (cup.Grams is >= 10 and <= 250) return cup.Grams.Value;
        return 100;
    }

    private static GapSuggestionDto ToDto(GapSuggestion s, IReadOnlyList<GapTarget> targets)
    {
        var items = s.Items.Select(i => new GapItemDto(i.Candidate.Kind.ToString(), i.Candidate.FoodId, i.Candidate.RecipeId,
            i.Candidate.Name, Math.Round(i.Amount, 2), i.Candidate.StepUnit, NutritionDto.From(i.Nutrients))).ToList();

        var kcalLeft = s.RemainingAfter.Get(NutrientIds.Energy);
        var proteinLeft = s.RemainingAfter.Get(NutrientIds.Protein);
        var parts = new List<string>
        {
            Math.Abs(kcalLeft) < 1 ? "hits calories exactly" :
            kcalLeft > 0 ? $"leaves {kcalLeft:0} kcal" : $"{-kcalLeft:0} kcal over",
        };
        if (targets.Any(t => t.NutrientId == NutrientIds.Protein))
            parts.Add(proteinLeft <= 0.5 ? "protein met" : $"protein short {proteinLeft:0} g");
        var metMicros = targets
            .Where(t => t.Kind == TargetKind.Goal && t.NutrientId is not (NutrientIds.Energy or NutrientIds.Protein or NutrientIds.Carbohydrate or NutrientIds.Fat))
            .Where(t => t.Remaining > 0 && s.RemainingAfter.Get(t.NutrientId) <= 0)
            .Select(t => NutrientCatalog.Get(t.NutrientId).Name)
            .ToList();
        if (metMicros.Count > 0) parts.Add($"completes {string.Join(", ", metMicros)}");

        return new GapSuggestionDto(items, NutritionDto.From(s.Added), NutritionDto.From(s.RemainingAfter), string.Join("; ", parts));
    }
}
