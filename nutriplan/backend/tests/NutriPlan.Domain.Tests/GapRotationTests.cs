using NutriPlan.Domain.Diary;
using NutriPlan.Domain.Nutrients;
using NutriPlan.Domain.Planning;

namespace NutriPlan.Domain.Tests;

/// <summary>"Show different ideas": the same engine, minus ideas already shown, until the qualifying ones run out.</summary>
public class GapRotationTests
{
    private static readonly GapFillPolicy P = new();

    private static NutrientProfile N(double kcal, double protein, double fiber, double sodium = 20) =>
        new(new Dictionary<int, double> { [NutrientIds.Energy] = kcal, [NutrientIds.Protein] = protein, [NutrientIds.Fiber] = fiber, [NutrientIds.Sodium] = sodium });

    private static GapCandidate Food(string name, FoodGroup group, double grams, double kcal, double protein, double fiber, bool countable = false, GapOrigin origin = GapOrigin.Frequent) =>
        new($"f:{name}", ItemKind.Food, Guid.NewGuid(), null, name, GapRoles.RoleOf(group), group, origin, N(kcal, protein, fiber), grams, "g", $"{grams} g", countable, Familiarity: 5);

    private static GapCandidate Recipe(string name, double kcal, double protein, double fiber, GapOrigin origin = GapOrigin.SavedRecipe) =>
        new($"r:{name}", ItemKind.Recipe, null, Guid.NewGuid(), name, GapRole.Meal, FoodGroup.Other, origin, N(kcal, protein, fiber, 500), 1, "serving", "1 serving");

    private static List<GapCandidate> Pool() =>
    [
        Food("Greek yogurt", FoodGroup.Dairy, 170, 100, 17.3, 0, countable: true),
        Food("Almonds", FoodGroup.NutsSeeds, 28, 164, 6, 3.5),
        Food("Banana", FoodGroup.Fruit, 118, 105, 1.3, 3.1, countable: true),
        Food("Apple", FoodGroup.Fruit, 182, 95, 0.5, 4.4, countable: true),
        Food("Blueberries", FoodGroup.Fruit, 148, 84, 1.1, 3.6),
        Food("Cottage cheese", FoodGroup.Dairy, 113, 92, 12, 0),
        Food("Egg", FoodGroup.Egg, 50, 72, 6.3, 0, countable: true),
        Food("Chicken breast", FoodGroup.Protein, 120, 198, 37, 0),
        Food("Salmon", FoodGroup.Protein, 140, 290, 31, 0),
        Food("Broccoli", FoodGroup.Vegetable, 150, 52, 3.6, 4.3),
        Food("Brown rice", FoodGroup.Grain, 195, 216, 5, 3.5),
        Food("Lentils", FoodGroup.Legume, 100, 116, 9, 7.9),
        Food("Black beans", FoodGroup.Legume, 172, 227, 15, 15),
        Recipe("Chicken and rice bowl", 520, 38, 6),
        Recipe("Lentil soup", 280, 16, 12),
        Recipe("Tofu stir-fry", 420, 24, 7),
    ];

    private static List<GapTarget> Needs(double kcal = 900, double protein = 50, double fiber = 18) =>
    [
        new(NutrientIds.Energy, kcal, 2000, TargetKind.Goal, 4),
        new(NutrientIds.Protein, protein, 100, TargetKind.Goal, P.ProteinWeight),
        new(NutrientIds.Fiber, fiber, 28, TargetKind.Goal, P.FiberWeight),
        new(NutrientIds.Sodium, 1500, 2300, TargetKind.Limit, 1),
    ];

    /// <summary>Pages through ideas the way the app does: each page excludes everything shown before it.</summary>
    private static List<GapPage> PageThrough(IReadOnlyList<GapTarget> needs, IReadOnlyList<GapCandidate> pool, GapMode mode, int max = 50, GapContext? ctx = null)
    {
        var shown = new HashSet<string>();
        var pages = new List<GapPage>();
        for (var i = 0; i < max; i++)
        {
            var page = GapRecommender.SuggestPage(needs, pool, mode, (ctx ?? new GapContext()) with { Exclude = shown.ToHashSet() }, P);
            pages.Add(page);
            if (page.Items.Count == 0) break;
            foreach (var s in page.Items) shown.Add(GapRecommender.IdOf(s));
        }
        return pages;
    }

    [Fact]
    public void Consecutive_pages_bring_different_valid_ideas_and_never_repeat_one()
    {
        var pages = PageThrough(Needs(), Pool(), GapMode.BestMatch);
        Assert.True(pages.Count >= 3, "there are more qualifying ideas than one page");
        var first = pages[0].Items.Select(GapRecommender.IdOf).ToList();
        var second = pages[1].Items.Select(GapRecommender.IdOf).ToList();
        Assert.NotEmpty(second);
        Assert.Empty(first.Intersect(second));
        var all = pages.SelectMany(p => p.Items).Select(GapRecommender.IdOf).ToList();
        Assert.Equal(all.Count, all.Distinct().Count()); // nothing shown twice in a session
        Assert.True(pages[0].More > 0);
        // Every rotated idea is still one the engine itself qualifies: same calorie window, limits and portions.
        foreach (var s in pages.SelectMany(p => p.Items))
        {
            Assert.InRange(s.Added.Calories, 1, 900 * (1 + P.CalorieSlackPct) + 1e-6);
            Assert.True(s.Added.Get(NutrientIds.Sodium) <= 1500 + 1e-6);
            Assert.All(s.Items, i => Assert.Contains(i.Multiple, GapRecommender.Multiples(i.Candidate, P)));
        }
    }

    [Fact]
    public void The_first_page_is_the_best_ideas_with_different_leads_in_score_order()
    {
        var page = GapRecommender.SuggestPage(Needs(), Pool(), GapMode.BestMatch, new GapContext(), P);
        Assert.Equal(0, page.Skipped);
        Assert.Equal(P.MaxSuggestions, page.Items.Count);
        // Same rule as before rotation existed: walk all qualifying ideas best-first, keep the first per lead food.
        var second = PageThrough(Needs(), Pool(), GapMode.BestMatch, max: 1)[0];
        Assert.Equal(page.Items.Select(GapRecommender.IdOf), second.Items.Select(GapRecommender.IdOf));
        Assert.True(page.Items.Zip(page.Items.Skip(1)).All(x => x.First.Score >= x.Second.Score - 1e-9));
        Assert.Equal(page.Items.Count, page.Items.Select(s => s.Items.OrderBy(i => i.Candidate.Role switch { GapRole.Meal => 0, GapRole.Main => 1, GapRole.Snack => 2, _ => 3 })
            .ThenBy(i => i.Candidate.Key, StringComparer.Ordinal).First().Candidate.Key).Distinct().Count());
    }

    [Fact]
    public void Identical_inputs_give_identical_pages()
    {
        var a = PageThrough(Needs(), Pool(), GapMode.BestMatch).SelectMany(p => p.Items).Select(GapRecommender.IdOf).ToList();
        var b = PageThrough(Needs(), Pool(), GapMode.BestMatch).SelectMany(p => p.Items).Select(GapRecommender.IdOf).ToList();
        Assert.Equal(a, b);
    }

    [Fact]
    public void An_idea_is_the_same_whatever_the_order_of_its_foods()
    {
        var pool = Pool();
        var yogurt = pool.Single(c => c.Name == "Greek yogurt");
        var berries = pool.Single(c => c.Name == "Blueberries");
        Assert.Equal(GapRecommender.IdOf([yogurt.Key, berries.Key]), GapRecommender.IdOf([berries.Key, yogurt.Key]));
        Assert.Matches("^[0-9a-f]{16}$", GapRecommender.IdOf([yogurt.Key]));

        // Across a whole session no two ideas are the same foods, reordered or at another amount.
        var sets = PageThrough(Needs(), pool, GapMode.BestMatch).SelectMany(p => p.Items)
            .Select(s => string.Join('+', s.Items.Select(i => i.Candidate.Key).Order(StringComparer.Ordinal))).ToList();
        Assert.Equal(sets.Count, sets.Distinct().Count());
    }

    [Fact]
    public void A_food_that_led_a_shown_idea_waits_until_fresh_ideas_have_been_offered()
    {
        var pages = PageThrough(Needs(), Pool(), GapMode.BestMatch);
        var firstLeads = pages[0].Items.Select(Lead).ToHashSet();
        Assert.NotEmpty(pages[1].Items);
        Assert.All(pages[1].Items, s => Assert.DoesNotContain(Lead(s), firstLeads)); // the pool has fresh leads, so they come first
        // Shown leads aren't banned: once fresh ideas run out, other ideas built around them still come.
        Assert.Contains(pages.Skip(1).SelectMany(p => p.Items), s => firstLeads.Contains(Lead(s)));
        static string Lead(GapSuggestion s) => s.Items.OrderBy(i => i.Candidate.Role switch { GapRole.Meal => 0, GapRole.Main => 1, GapRole.Snack => 2, _ => 3 }).ThenBy(i => i.Candidate.Key, StringComparer.Ordinal).First().Candidate.Key;
    }

    [Theory]
    [InlineData(GapMode.QuickSnack)]
    [InlineData(GapMode.Meal)]
    [InlineData(GapMode.SavedRecipes)]
    [InlineData(GapMode.Pantry)]
    public void Rotation_stays_inside_the_chosen_filter(GapMode mode)
    {
        var pool = Pool().Select(c => c.Name is "Greek yogurt" or "Banana" or "Almonds" or "Lentil soup" ? c with { Origin = c.Origin | GapOrigin.Pantry } : c).ToList();
        var ideas = PageThrough(Needs(), pool, mode).SelectMany(p => p.Items).ToList();
        Assert.NotEmpty(ideas);
        foreach (var s in ideas)
        {
            switch (mode)
            {
                case GapMode.QuickSnack: Assert.Equal(GapCategory.Snack, s.Category); break;
                case GapMode.Meal: Assert.Equal(GapCategory.Meal, s.Category); break;
                case GapMode.SavedRecipes: Assert.All(s.Items, i => Assert.True(i.Candidate.IsRecipe)); break;
                case GapMode.Pantry: Assert.All(s.Items, i => Assert.True(i.Candidate.Origin.HasFlag(GapOrigin.Pantry))); break;
            }
        }
    }

    [Fact]
    public void When_every_qualifying_idea_has_been_shown_nothing_is_made_up()
    {
        var pages = PageThrough(Needs(), Pool(), GapMode.SavedRecipes);
        var last = pages[^1];
        Assert.Empty(last.Items);
        Assert.Equal(0, last.More);
        Assert.True(last.Skipped > 0); // exhausted, not "nothing fits"
        Assert.Equal(pages.Sum(p => p.Items.Count), last.Skipped);
        Assert.Equal(0, pages[^2].More);
    }

    [Fact]
    public void An_empty_pool_or_a_full_day_has_no_ideas_and_nothing_to_rotate()
    {
        var empty = GapRecommender.SuggestPage(Needs(), [], GapMode.BestMatch, new GapContext(), P);
        Assert.Equal((0, 0, 0), (empty.Items.Count, empty.More, empty.Skipped));
        var full = GapRecommender.SuggestPage(Needs(kcal: 20), Pool(), GapMode.BestMatch, new GapContext(Exclude: new HashSet<string> { "0123456789abcdef" }), P);
        Assert.Equal((0, 0, 0), (full.Items.Count, full.More, full.Skipped));
    }

    [Fact]
    public void Foods_and_recipes_already_logged_or_planned_today_are_not_suggested_again()
    {
        var pool = Pool();
        var first = GapRecommender.Suggest(Needs(), pool, GapMode.BestMatch, new GapContext(), P);
        var lead = first[0].Items[0].Candidate.Key;
        var onToday = new HashSet<string> { lead };
        var ideas = PageThrough(Needs(), pool, GapMode.BestMatch, ctx: new GapContext(OnToday: onToday)).SelectMany(p => p.Items);
        Assert.DoesNotContain(ideas, s => s.Items.Any(i => i.Candidate.Key == lead));
    }

    [Fact]
    public void Ideas_are_recalculated_for_what_is_left_and_skipped_ones_stay_skipped()
    {
        var shown = GapRecommender.Suggest(Needs(), Pool(), GapMode.BestMatch, new GapContext(), P).Select(GapRecommender.IdOf).ToHashSet();
        // After planning a 500 kcal meal, less is left: a fresh page fits the new room and still skips what was passed over.
        var after = GapRecommender.SuggestPage(Needs(kcal: 400, protein: 15, fiber: 8), Pool(), GapMode.BestMatch, new GapContext(Exclude: shown), P);
        Assert.All(after.Items, s => Assert.True(s.Added.Calories <= 400 * (1 + P.CalorieSlackPct) + 1e-6));
        Assert.DoesNotContain(after.Items, s => shown.Contains(GapRecommender.IdOf(s)));
    }
}
