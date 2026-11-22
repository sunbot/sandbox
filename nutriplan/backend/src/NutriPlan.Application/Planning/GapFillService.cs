using System.Text.RegularExpressions;
using Microsoft.Extensions.Options;
using NutriPlan.Application.Abstractions;
using NutriPlan.Application.Common;
using NutriPlan.Application.Foods;
using NutriPlan.Domain.Diary;
using NutriPlan.Domain.Foods;
using NutriPlan.Domain.Nutrients;
using NutriPlan.Domain.Planning;
using NutriPlan.Domain.Recipes;
using NutriPlan.Domain.Units;

namespace NutriPlan.Application.Planning;

public sealed record GapItemDto(string Kind, Guid? FoodId, Guid? RecipeId, string Name, double Amount, string Unit, NutritionDto Nutrition, string Portion);

public sealed record GapReasonDto(string Code, string Text, int? NutrientId);

/// <summary>What a suggestion does to one nutrient: for a goal, how much is still missing before and after; for a limit, how much room is left.</summary>
public sealed record GapEffectDto(int NutrientId, string Name, string Unit, string Kind, double Before, double After);

public sealed record GapSuggestionDto(
    IReadOnlyList<GapItemDto> Items, NutritionDto Adds, NutritionDto RemainingAfter, string Summary,
    string Category, IReadOnlyList<GapReasonDto> Reasons, IReadOnlyList<GapEffectDto> Effects);

public sealed record GapSwapDto(Guid PlanEntryId, string FromName, double FromCalories, GapItemDto To, double SavesCalories, IReadOnlyList<GapReasonDto> Reasons);

public sealed record GapTipItemDto(string Kind, Guid? FoodId, Guid? RecipeId, string Name, string Portion, double Amount, string Unit, double NutrientAmount, double DailySharePercent);

public sealed record GapTipDto(int NutrientId, string Name, string Unit, IReadOnlyList<GapTipItemDto> Items);

public sealed record GapModeDto(string Mode, int Count);

public sealed record GapReportDto(
    DateOnly Date,
    NutritionDto Remaining,
    IReadOnlyList<NutrientProgressGap> Gaps,
    IReadOnlyList<GapSuggestionDto> Suggestions,
    string Situation,
    string Message,
    string Mode,
    IReadOnlyList<GapModeDto> AvailableModes,
    string? EmptyReason,
    string? EmptyMessage,
    IReadOnlyList<GapSwapDto> Swaps,
    IReadOnlyList<GapTipDto> NextDay,
    IReadOnlyList<string> DataNotes);

/// <summary>A nutrient still short (or a limit exceeded). <see cref="DataComplete"/> is false when today's logged foods don't list it, so it can't be judged.</summary>
public sealed record NutrientProgressGap(int NutrientId, string Name, string Unit, double Remaining, double Target, string Kind, bool DataComplete = true);

public sealed record GapFillRequest(
    DateOnly Date, bool IncludePlanned = true, bool IncludeMicronutrients = true, int MaxItems = 3, bool RecipesOnly = false,
    GapMode? Mode = null, MealSlot? Meal = null);

/// <summary>
/// "What can I add to round out today?" Works out what's left of the day (calories eaten and still planned, goals,
/// limits, and whether the day's data supports judging each nutrient) and hands the deterministic
/// <see cref="GapRecommender"/> a pool of real, familiar choices: saved recipes, pantry foods, foods you eat and a few
/// staples, each sized in real portions. Nothing here asks a language model for nutrition.
/// </summary>
public sealed partial class GapFillService(
    ITargetsRepository targetsRepo,
    IDiaryRepository diary,
    IPlanRepository plan,
    IRecipeRepository recipes,
    IPantryRepository pantry,
    IFoodRepository foods,
    FoodService foodService,
    IOptions<GapFillPolicy>? policyOptions = null)
{
    private readonly GapFillPolicy _policy = policyOptions?.Value ?? new GapFillPolicy();

    /// <summary>Searched once each (best match) to seed suggestions when there's little history. Edit freely.</summary>
    public static readonly string[] StarterFoods =
    [
        "yogurt greek plain nonfat", "almonds", "egg whole raw", "banana raw", "apples raw with skin",
        "cottage cheese lowfat", "peanut butter smooth", "lentils mature seeds cooked boiled",
        "chicken broilers or fryers breast meat only cooked roasted", "salmon atlantic farmed cooked", "spinach raw",
        "milk lowfat 1%", "cheese cheddar", "avocados raw all commercial", "blueberries raw", "carrots raw",
        "broccoli cooked boiled", "tuna light canned in water drained", "beans black mature seeds cooked boiled", "oatmeal cooked", "rice brown cooked",
    ];

    public async Task<GapReportDto> SuggestAsync(GapFillRequest request, CancellationToken ct = default)
    {
        var p = _policy;
        var targets = await targetsRepo.GetAsync(ct);
        var date = request.Date;

        var eaten = (await diary.GetRangeAsync(date, date, ct)).Select(e => e.Item).ToList();
        var planned = request.IncludePlanned
            ? (await PlanReconciliation.ReadRangeAsync(plan, diary, date, date, ct)).Where(e => e.Status == PlanStatus.Planned).ToList()
            : [];
        var counted = eaten.Concat(planned.Select(e => e.Item)).ToList();
        var have = NutrientProfile.Sum(counted.Select(i => i.Nutrients));

        var needs = BuildTargets(targets, have, request.IncludeMicronutrients, DataCoverage(counted), p);
        var situation = GapRecommender.Classify(needs, p);
        var kcalLeft = needs.FirstOrDefault(n => n.NutrientId == NutrientIds.Energy)?.Remaining ?? 0;
        var mode = request.Mode ?? (request.RecipesOnly ? GapMode.SavedRecipes : GapMode.BestMatch);

        var (candidates, coEaten) = await BuildCandidatesAsync(date, ct);
        var ctx = new GapContext(request.Meal, coEaten);

        var suggestions = GapRecommender.Suggest(needs, candidates, mode, ctx, p);
        IReadOnlyList<GapModeAvailability> modes = [];
        if (situation is GapSituation.Open or GapSituation.Near) modes = GapRecommender.AvailableModes(needs, candidates, ctx, p);

        // With little or no room, offer swaps for what's still planned and ideas for another day instead of adding food.
        IReadOnlyList<GapSwap> swaps = [];
        IReadOnlyList<GapTip> tips = [];
        if (situation != GapSituation.Open)
        {
            swaps = GapRecommender.Swaps(needs, await PlannedForSwapsAsync(planned, ct), candidates, p);
            tips = GapRecommender.NextDay(needs, candidates, p);
        }

        var remaining = new NutrientProfile(needs.ToDictionary(t => t.NutrientId, t => t.Remaining));
        var gaps = needs
            .Where(t => t.Kind == TargetKind.Goal ? t.Remaining > t.DailyTarget * p.OpenNeedShare : t.Remaining < 0)
            .Select(t =>
            {
                var def = NutrientCatalog.Get(t.NutrientId);
                return new NutrientProgressGap(t.NutrientId, def.Name, def.Unit, Math.Round(t.Remaining, 2), t.DailyTarget, t.Kind.ToString(), t.Evaluable);
            })
            .ToList();
        var dataNotes = needs
            .Where(t => t is { Kind: TargetKind.Goal, Evaluable: false } && t.Remaining > t.DailyTarget * p.OpenNeedShare)
            .Select(t => $"Some foods logged today don't list {NutrientCatalog.Get(t.NutrientId).Name.ToLowerInvariant()}, so it isn't counted as a gap or used to rank ideas.")
            .Concat(needs.Where(t => t is { Kind: TargetKind.Limit, Evaluable: false })
                .Select(t => $"Some foods logged today don't list {NutrientCatalog.Get(t.NutrientId).Name.ToLowerInvariant()}, so the room left under your limit may be less than shown."))
            .ToList();

        var (emptyReason, emptyMessage) = suggestions.Count > 0 ? (null, null) : Explain(situation, mode, kcalLeft, needs, candidates, tips.Count > 0 || swaps.Count > 0, p);

        return new GapReportDto(date, NutritionDto.From(remaining), gaps, suggestions.Select(s => ToDto(s, needs)).ToList(),
            situation.ToString(), SituationMessage(situation, kcalLeft), mode.ToString(),
            modes.Select(m => new GapModeDto(m.Mode.ToString(), m.Count)).ToList(), emptyReason, emptyMessage,
            swaps.Select(ToDto).ToList(), tips.Select(ToDto).ToList(), dataNotes);
    }

    // ── Needs ──────────────────────────────────────────────────────────────────────────────────────

    /// <summary>Per-nutrient share of today's logged calories whose food lists that nutrient (1 when nothing is logged).</summary>
    public static Func<int, double> DataCoverage(IReadOnlyList<ItemSnapshot> items)
    {
        var total = items.Sum(i => i.Nutrients.Calories);
        return id => total <= 0 ? 1 : items.Where(i => i.Nutrients.Has(id)).Sum(i => i.Nutrients.Calories) / total;
    }

    public static IReadOnlyList<GapTarget> BuildTargets(NutritionTargets targets, NutrientProfile have, bool includeMicros, Func<int, double>? coverage = null, GapFillPolicy? policy = null)
    {
        policy ??= new GapFillPolicy();
        var list = new List<GapTarget>();
        void Add(int id, double weight)
        {
            if (targets.TargetFor(id) is not { } daily || daily <= 0) return;
            var evaluable = id == NutrientIds.Energy || coverage is null || coverage(id) >= policy.MinDataCoverage;
            list.Add(new GapTarget(id, daily - have.Get(id), daily, targets.KindFor(id), weight, evaluable));
        }

        Add(NutrientIds.Energy, 4);
        Add(NutrientIds.Protein, policy.ProteinWeight);
        Add(NutrientIds.Carbohydrate, policy.MacroWeight);
        Add(NutrientIds.Fat, policy.MacroWeight);
        if (includeMicros)
        {
            foreach (var id in targets.EffectiveFocusNutrients.Distinct())
            {
                if (list.Any(t => t.NutrientId == id)) continue;
                Add(id, id == NutrientIds.Fiber ? policy.FiberWeight : policy.MicronutrientWeight);
            }
        }
        return list;
    }

    // ── Candidates ─────────────────────────────────────────────────────────────────────────────────

    private async Task<(List<GapCandidate> Candidates, IReadOnlySet<string> CoEaten)> BuildCandidatesAsync(DateOnly date, CancellationToken ct)
    {
        var p = _policy;
        var candidates = new Dictionary<string, GapCandidate>();
        void Merge(GapCandidate c)
        {
            if (!candidates.TryGetValue(c.Key, out var existing)) { candidates[c.Key] = c; return; }
            candidates[c.Key] = existing with
            {
                Origin = existing.Origin | c.Origin,
                Familiarity = Math.Max(existing.Familiarity, c.Familiarity),
                Slots = existing.Slots is null ? c.Slots : c.Slots is null ? existing.Slots : existing.Slots.Concat(c.Slots).ToHashSet(),
                MaxMultiple = Math.Min(existing.MaxMultiple, c.MaxMultiple),
            };
        }

        var frequent = await diary.GetFrequentItemsAsync(days: 90, limit: 60, ct);
        var pantryAll = await pantry.ListAsync(ct);
        var inPantry = pantryAll.Where(i => i.FoodId is not null).Select(i => i.FoodId!.Value).ToHashSet(); // staples included: they count for "can cook it"
        var recipeUse = frequent.Where(f => f.Item.RecipeId is not null).GroupBy(f => f.Item.RecipeId!.Value).ToDictionary(g => g.Key, g => g.ToList());

        // 1) Saved recipes with trustworthy nutrition: one serving is the unit.
        foreach (var r in await recipes.ListAsync(ct: ct))
        {
            var perServing = r.NutritionPerServing;
            if (r.NutritionCoverage < 0.8 || perServing.Calories <= 0) continue;
            var origin = GapOrigin.SavedRecipe | (r.IsFavorite ? GapOrigin.Favorite : 0);
            recipeUse.TryGetValue(r.Id, out var uses);
            if (uses?.Sum(u => u.Count) >= p.FrequentMinCount) origin |= GapOrigin.Frequent;
            // A recipe whose matched ingredients are all in the pantry can be made from it.
            var counted = r.Ingredients.Where(i => i.CountsTowardNutrition && i.FoodId is not null).ToList();
            if (counted.Count > 0 && counted.All(i => inPantry.Contains(i.FoodId!.Value))) origin |= GapOrigin.Pantry;
            Merge(new GapCandidate($"r:{r.Id}", ItemKind.Recipe, null, r.Id, r.Name, GapRoles.ClassifyRecipe(r.Categories, perServing.Calories, _policy), FoodGroup.Other, origin,
                perServing, 1, "serving", string.IsNullOrWhiteSpace(r.ServingDescription) ? "1 serving" : $"1 serving ({r.ServingDescription!.Trim()})",
                Familiarity: uses?.Sum(u => u.Count) ?? 0, Slots: uses?.Select(u => u.Meal).ToHashSet()));
        }

        // 2) Foods you log, at the amount you usually eat; 3) what's in the pantry, as much as you have.
        var usualGrams = frequent.Where(f => f.Item.FoodId is not null && f.Item.Grams is > 0).GroupBy(f => f.Item.FoodId!.Value).ToDictionary(g => g.Key, g => g.ToList());
        var pantryItems = pantryAll.Where(i => i.FoodId is not null && !i.IsStaple).ToList();
        var pantryByFood = pantryItems.GroupBy(i => i.FoodId!.Value).ToDictionary(g => g.Key, g => g.ToList());
        var foodMap = await foods.GetManyAsync(usualGrams.Keys.Concat(pantryByFood.Keys).Distinct().ToList(), ct);

        foreach (var food in foodMap.Values.Where(f => !f.IsVolume && !f.IsArchived))
        {
            usualGrams.TryGetValue(food.Id, out var uses);
            pantryByFood.TryGetValue(food.Id, out var stocked);
            var typical = uses is null ? (double?)null : uses.OrderByDescending(u => u.Count).First().Item.Grams;
            var count = uses?.Sum(u => u.Count) ?? 0;
            var origin = (count >= p.FrequentMinCount ? GapOrigin.Frequent : 0) | (stocked is not null ? GapOrigin.Pantry : 0);
            if (FoodCandidate(food, typical, origin, count, uses?.Select(u => u.Meal).ToHashSet(), stocked, loggedByYou: uses is not null) is { } c) Merge(c);
        }

        // 4) Everyday staples so there's something to suggest on day one.
        if (candidates.Values.Count(c => c.Role != GapRole.Ingredient) < p.StarterThreshold)
        {
            foreach (var food in await StarterFoodsAsync(ct))
                if (!food.IsVolume && FoodCandidate(food, null, GapOrigin.Starter, 0, null, null) is { } c) Merge(c);
        }

        return (candidates.Values.Where(c => c.PerPortion.Calories > 0).ToList(), await CoEatenPairsAsync(date, ct));
    }

    /// <summary>Pairs of foods/recipes you've logged in the same meal on at least a few days: a signal that they go together.</summary>
    private async Task<IReadOnlySet<string>> CoEatenPairsAsync(DateOnly date, CancellationToken ct)
    {
        var entries = await diary.GetRangeAsync(date.AddDays(-90), date, ct);
        var counts = new Dictionary<string, int>();
        foreach (var meal in entries.GroupBy(e => (e.Date, e.Meal)))
        {
            var keys = meal.Select(e => e.Item.FoodId is { } f ? $"f:{f}" : e.Item.RecipeId is { } r ? $"r:{r}" : null).OfType<string>().Distinct().Order(StringComparer.Ordinal).Take(8).ToList();
            for (var i = 0; i < keys.Count; i++)
                for (var j = i + 1; j < keys.Count; j++)
                {
                    var key = GapContext.PairKey(keys[i], keys[j]);
                    counts[key] = counts.GetValueOrDefault(key) + 1;
                }
        }
        return counts.Where(kv => kv.Value >= _policy.CoEatenMinCount).Select(kv => kv.Key).ToHashSet();
    }

    /// <summary>
    /// The starter staples, resolved once per process: they are shared catalog foods, so which food a query maps to is the
    /// same for everyone (searched without anyone's history). Each request then needs one lookup, not ~20 searches.
    /// </summary>
    private static readonly System.Collections.Concurrent.ConcurrentDictionary<string, Guid> StarterIds = new();

    private async Task<IReadOnlyList<Food>> StarterFoodsAsync(CancellationToken ct)
    {
        var found = await foods.GetManyAsync(StarterIds.Values.Distinct().ToList(), ct);
        var result = new List<Food>();
        foreach (var query in StarterFoods)
        {
            if (StarterIds.TryGetValue(query, out var id) && found.TryGetValue(id, out var cached)) { result.Add(cached); continue; }
            StarterIds.TryRemove(query, out _);
            var best = (await foodService.SearchRankedAsync(query, 1, ct, useHistory: false)).FirstOrDefault();
            if (best is null) continue;
            if (best.Food.IsShared) StarterIds[query] = best.Food.Id;
            result.Add(best.Food);
        }
        return result;
    }

    private GapCandidate? FoodCandidate(Food food, double? usualGrams, GapOrigin origin, int familiarity, IReadOnlySet<MealSlot>? slots, IReadOnlyList<Domain.Pantry.PantryItem>? stocked, bool loggedByYou = false)
    {
        var (group, role) = GapRoles.ClassifyFood(food.Name, food.Category);
        // A food the rules know nothing about is still fine if you log it; a known ingredient (oil, coffee, flour) never is.
        if (role == GapRole.Ingredient)
        {
            if (!loggedByYou || GapRoles.Recognized(food.Name, food.Category)) return null;
            role = GapRole.Snack;
        }
        if (ChoosePortion(food, usualGrams, _policy) is not { } portion) return null;
        // A prepared dish (soup, pizza, sandwich) is sized by its calories, not assembled from parts.
        if (group == FoodGroup.Mixed) role = GapRoles.ClassifyRecipe([], food.NutrientsFor(portion.Grams).Calories, _policy);

        var maxMultiple = double.MaxValue;
        if (stocked is not null)
        {
            // Only what you actually have: pantry items without a weight are treated as "some", so they aren't limited.
            // Weighed rows set the limit (rows with no weight add an unknown extra, never less than what's weighed); a food with
            // no weights at all is "some" and not limited.
            var weighed = stocked.Where(i => i.Grams is not null).ToList();
            if (weighed.Count > 0) maxMultiple = weighed.Sum(i => i.Grams!.Value) / portion.Grams;
            if (maxMultiple < _policy.MinPortionFraction)
            {
                origin &= ~GapOrigin.Pantry;
                maxMultiple = double.MaxValue;
                if (origin == GapOrigin.None) return null;
            }
        }
        return new GapCandidate($"f:{food.Id}", ItemKind.Food, food.Id, null, food.DisplayName, role, group, origin, food.NutrientsFor(portion.Grams),
            portion.Grams, food.BaseUnit, portion.Label, portion.Countable, maxMultiple, familiarity, slots);
    }

    public sealed record ChosenPortion(double Grams, string Label, bool Countable);

    private static readonly Regex CountableWords = CountableRegex();

    /// <summary>
    /// A real portion for a food, or null. Priority: the amount you usually log, a labelled/NLEA serving, the food's
    /// natural item ("1 medium"), a cup. A food with none of these is not suggested: a weight is never invented.
    /// </summary>
    public static ChosenPortion? ChoosePortion(Food food, double? usualGrams, GapFillPolicy policy)
    {
        bool Ok(double g) => g >= policy.MinPortionGrams && g <= policy.MaxPortionGrams;
        string Label(FoodPortion p, double grams) => $"{(p.Description.Length > 0 && char.IsDigit(p.Description[0]) ? p.Description : $"{FormatAmount(p.Amount)} {p.Description}")} ({Math.Round(grams)} g)";

        if (usualGrams is { } usual && Ok(usual))
        {
            var match = food.Portions.FirstOrDefault(p => p.GramsPerUnit > 0 && Math.Abs(p.GramsPerUnit - usual) <= 0.1 * usual);
            return match is not null
                ? new ChosenPortion(usual, Label(match, usual), CountableWords.IsMatch(match.Description))
                : new ChosenPortion(usual, $"{Math.Round(usual)} g (your usual)", false);
        }

        var nlea = food.Portions.FirstOrDefault(x => x.Description.Contains("NLEA", StringComparison.OrdinalIgnoreCase))
                   ?? food.Portions.FirstOrDefault(x => x.Description.StartsWith("serving", StringComparison.OrdinalIgnoreCase));
        if (nlea is not null && Ok(nlea.GramsPerUnit)) return new ChosenPortion(nlea.GramsPerUnit, Label(nlea, nlea.GramsPerUnit), CountableWords.IsMatch(nlea.Description));

        var item = QuantityResolver.Resolve(food, 1, null);
        if (item is { Method: ResolutionMethod.DefaultPortion, Grams: { } g, Portion: { } ip } && Ok(g))
            return new ChosenPortion(g, Label(ip, g), CountableWords.IsMatch(ip.Description));

        // A cup only if USDA measured a cup of this very food (not one derived from, say, a teaspoon's weight).
        var cup = food.Portions.FirstOrDefault(x => CupWord.IsMatch(x.Description) && Ok(x.GramsPerUnit));
        return cup is null ? null : new ChosenPortion(cup.GramsPerUnit, Label(cup, cup.GramsPerUnit), false);
    }

    [GeneratedRegex(@"\bcups?\b", RegexOptions.IgnoreCase)]
    private static partial Regex CupRegex();

    private static readonly Regex CupWord = CupRegex();

    [GeneratedRegex(@"\b(small|medium|large|extra large|jumbo|slice|piece|container|bar|stick|each|egg|can|packet|bottle|link|patty|fillet|whole)\b", RegexOptions.IgnoreCase)]
    private static partial Regex CountableRegex();

    private static string FormatAmount(double v) => Math.Abs(v - Math.Round(v)) < 0.01 ? Math.Round(v).ToString("0") : v.ToString("0.##");

    // ── Planned items, for swaps ───────────────────────────────────────────────────────────────────

    private async Task<IReadOnlyList<GapPlanned>> PlannedForSwapsAsync(IReadOnlyList<PlanEntry> planned, CancellationToken ct)
    {
        var recipeIds = planned.Where(e => e.Item.RecipeId is not null).Select(e => e.Item.RecipeId!.Value).Distinct().ToList();
        var recipeMap = recipeIds.Count == 0 ? new Dictionary<Guid, Recipe>() : (await recipes.GetManyAsync(recipeIds, ct)).ToDictionary(kv => kv.Key, kv => kv.Value);
        var result = new List<GapPlanned>();
        foreach (var e in planned)
        {
            GapRole role;
            string? key;
            if (e.Item.RecipeId is { } rid && recipeMap.TryGetValue(rid, out var recipe)) { role = GapRoles.ClassifyRecipe(recipe.Categories, e.Item.Nutrients.Calories, _policy); key = $"r:{rid}"; }
            else if (e.Item.FoodId is { } fid)
            {
                var (group, foodRole) = GapRoles.ClassifyFood(e.Item.Name, null);
                role = group == FoodGroup.Mixed ? GapRoles.ClassifyRecipe([], e.Item.Nutrients.Calories, _policy) : foodRole;
                key = $"f:{fid}";
            }
            else continue; // quick calories: nothing to swap it with
            var category = role switch { GapRole.Meal => GapCategory.Meal, GapRole.Snack => GapCategory.Snack, GapRole.Side => GapCategory.Side, _ => (GapCategory?)null };
            if (category is { } c) result.Add(new GapPlanned(e.Id, e.Item.Name, c, e.Item.Nutrients, key));
        }
        return result;
    }

    // ── Wording ────────────────────────────────────────────────────────────────────────────────────

    public static string SituationMessage(GapSituation situation, double kcalLeft) => situation switch
    {
        GapSituation.Over => $"You're about {Math.Round(-kcalLeft):N0} kcal above today's target. There's no need to add anything.",
        GapSituation.AtTarget => "You're right at today's target, so there's nothing to add.",
        GapSituation.Near => $"About {Math.Round(kcalLeft):N0} kcal left: room for a small snack.",
        _ => $"About {Math.Round(kcalLeft):N0} kcal left to plan.",
    };

    private (string Reason, string Message) Explain(GapSituation situation, GapMode mode, double kcalLeft, IReadOnlyList<GapTarget> needs, IReadOnlyList<GapCandidate> pool, bool hasOtherIdeas, GapFillPolicy p)
    {
        if (situation == GapSituation.Over)
            return ("Over", hasOtherIdeas ? "Here are some swaps and ideas for tomorrow instead." : "Today is done. Tomorrow is a fresh start.");
        if (situation == GapSituation.AtTarget)
            return ("AtTarget", hasOtherIdeas ? "If you'd like a change, here are lighter swaps and ideas for another day." : "Nothing more is needed today.");
        if (GapRecommender.OpenNeeds(needs, p).Count == 0)
            return ("NeedsMet", "Your goals for today look covered, so there's nothing to fill.");
        return mode switch
        {
            GapMode.Pantry when !pool.Any(c => c.Origin.HasFlag(GapOrigin.Pantry)) => ("NoPantry", "No pantry foods to suggest. Add foods to your pantry, or try Best match."),
            GapMode.SavedRecipes when !pool.Any(c => c.IsRecipe) => ("NoRecipes", "No saved recipes with full nutrition yet. Import or save a few, or try Best match."),
            GapMode.Meal when kcalLeft < p.MinMealKcal => ("NoRoomForMeal", "There isn't room for a full meal today. Try Quick snack."),
            GapMode.Pantry => ("NothingFits", "Nothing in your pantry fits well right now. Try Best match."),
            GapMode.SavedRecipes => ("NothingFits", "None of your saved recipes fit what's left today. Try Best match."),
            _ => ("NothingFits", "Nothing fits well right now. Nothing is better than a poor suggestion."),
        };
    }

    // ── DTOs ───────────────────────────────────────────────────────────────────────────────────────

    private static string MultipleText(double m) => m switch { 0.5 => "½", 1 => "1", 1.5 => "1½", 2 => "2", _ => m.ToString("0.##") };

    private static GapItemDto ToDto(GapSuggestionItem i) => new(i.Candidate.Kind.ToString(), i.Candidate.FoodId, i.Candidate.RecipeId,
        i.Candidate.Name, Math.Round(i.Amount, 2), i.Candidate.Unit, NutritionDto.From(i.Nutrients),
        i.Multiple == 1 ? i.Candidate.PortionLabel : $"{MultipleText(i.Multiple)} × {i.Candidate.PortionLabel}");

    private static GapSuggestionDto ToDto(GapSuggestion s, IReadOnlyList<GapTarget> targets)
    {
        var kcalLeft = s.RemainingAfter.Get(NutrientIds.Energy);
        var summary = string.Join("; ", s.Reasons.Take(2).Select(r => r.Text));
        if (summary.Length == 0) summary = kcalLeft > 0 ? $"Leaves {kcalLeft:0} kcal" : "Fits today";
        return new GapSuggestionDto(s.Items.Select(ToDto).ToList(), NutritionDto.From(s.Added), NutritionDto.From(s.RemainingAfter), summary,
            s.Category.ToString(), s.Reasons.Select(r => new GapReasonDto(r.Code, r.Text, r.NutrientId)).ToList(),
            s.Effects.Select(e =>
            {
                var def = NutrientCatalog.Get(e.NutrientId);
                return new GapEffectDto(e.NutrientId, def.Name, def.Unit, e.Kind.ToString(), Math.Round(e.Before, 1), Math.Round(e.After, 1));
            }).ToList());
    }

    private static GapSwapDto ToDto(GapSwap s) => new(s.From.EntryId, s.From.Name, Math.Round(s.From.Nutrients.Calories), ToDto(s.To), s.SavesKcal,
        s.Reasons.Select(r => new GapReasonDto(r.Code, r.Text, r.NutrientId)).ToList());

    private static GapTipDto ToDto(GapTip t)
    {
        var def = NutrientCatalog.Get(t.NutrientId);
        return new GapTipDto(t.NutrientId, def.Name, def.Unit, t.Items.Select(i => new GapTipItemDto(i.Candidate.Kind.ToString(), i.Candidate.FoodId, i.Candidate.RecipeId,
            i.Candidate.Name, i.Candidate.PortionLabel, i.Candidate.PortionAmount, i.Candidate.Unit, Math.Round(i.NutrientAmount, 1), Math.Round(i.DailyShare * 100))).ToList());
    }
}
