using NutriPlan.Domain.Diary;
using NutriPlan.Domain.Nutrients;
using NutriPlan.Domain.Planning;

namespace NutriPlan.Domain.Tests;

/// <summary>
/// Fill the Gaps recommendations: practical, realistic and honest about data. Each scenario uses real-world portion
/// nutrition (a 170 g yogurt container, a medium banana, 150 g cooked broccoli…) and checks both the numbers and that
/// the suggestion is something a person would actually eat.
/// </summary>
public class GapRecommenderTests
{
    private static readonly GapFillPolicy P = new();
    private static readonly GapContext NoContext = new();

    // ── Helpers ────────────────────────────────────────────────────────────────────────────────────

    private static NutrientProfile Nutrients(double kcal, double protein, double? fiber, double? sodium = null)
    {
        var d = new Dictionary<int, double> { [NutrientIds.Energy] = kcal, [NutrientIds.Protein] = protein };
        if (fiber is { } f) d[NutrientIds.Fiber] = f;
        if (sodium is { } s) d[NutrientIds.Sodium] = s;
        return new NutrientProfile(d);
    }

    private static GapCandidate Food(string name, FoodGroup group, double portionGrams, string label, double kcal, double protein, double? fiber,
        double? sodium = 20, GapOrigin origin = GapOrigin.Frequent, bool countable = false, int familiarity = 5, GapRole? role = null) =>
        new($"f:{name}", ItemKind.Food, Guid.NewGuid(), null, name, role ?? GapRoles.RoleOf(group), group, origin,
            Nutrients(kcal, protein, fiber, sodium), portionGrams, "g", label, countable, Familiarity: familiarity);

    private static GapCandidate Recipe(string name, GapRole role, double kcal, double protein, double fiber, double sodium = 500, GapOrigin origin = GapOrigin.SavedRecipe | GapOrigin.Favorite) =>
        new($"r:{name}", ItemKind.Recipe, null, Guid.NewGuid(), name, role, FoodGroup.Other, origin, Nutrients(kcal, protein, fiber, sodium), 1, "serving", "1 serving");

    // Everyday foods, one real portion each (USDA household measures).
    private static GapCandidate Yogurt(GapOrigin o = GapOrigin.Frequent) => Food("Greek yogurt, plain nonfat", FoodGroup.Dairy, 170, "1 container (170 g)", 100, 17.3, 0, 61, o, countable: true);
    private static GapCandidate Almonds(GapOrigin o = GapOrigin.Frequent) => Food("Almonds", FoodGroup.NutsSeeds, 28, "1 oz (28 g)", 164, 6, 3.5, 0, o);
    private static GapCandidate Banana() => Food("Banana", FoodGroup.Fruit, 118, "1 medium (118 g)", 105, 1.3, 3.1, 1, countable: true);
    private static GapCandidate Apple() => Food("Apple", FoodGroup.Fruit, 182, "1 medium (182 g)", 95, 0.5, 4.4, 2, countable: true);
    private static GapCandidate Egg() => Food("Egg, whole, cooked", FoodGroup.Egg, 50, "1 large (50 g)", 72, 6.3, 0, 71, countable: true);
    private static GapCandidate Chicken(GapOrigin o = GapOrigin.Frequent) => Food("Chicken breast, roasted", FoodGroup.Protein, 120, "4 oz (120 g)", 198, 37, 0, 90, o);
    private static GapCandidate Broccoli(GapOrigin o = GapOrigin.Frequent) => Food("Broccoli, cooked", FoodGroup.Vegetable, 150, "1 cup (150 g)", 52, 3.6, 4.3, 45, o);
    private static GapCandidate Rice() => Food("Brown rice, cooked", FoodGroup.Grain, 195, "1 cup (195 g)", 216, 5, 3.5, 10);
    private static GapCandidate Lentils() => Food("Lentils, cooked", FoodGroup.Legume, 100, "100 g", 116, 9, 7.9, 2);
    private static GapCandidate Coffee() => Food("Coffee, brewed", FoodGroup.Other, 237, "1 cup (237 g)", 2, 0.3, 0, 5, role: GapRole.Snack);

    private static List<GapTarget> Needs(double kcalRemaining, double protein = 40, double fiber = 18, double? sodiumRemaining = null, bool fiberKnown = true)
    {
        var list = new List<GapTarget>
        {
            new(NutrientIds.Energy, kcalRemaining, 2000, TargetKind.Goal, 4),
            new(NutrientIds.Protein, protein, 100, TargetKind.Goal, P.ProteinWeight),
            new(NutrientIds.Fiber, fiber, 28, TargetKind.Goal, P.FiberWeight, fiberKnown),
        };
        if (sodiumRemaining is { } s) list.Add(new(NutrientIds.Sodium, s, 2300, TargetKind.Limit, 1));
        return list;
    }

    private static List<GapCandidate> EverydayPool() =>
        [Yogurt(), Almonds(), Banana(), Apple(), Egg(), Chicken(), Broccoli(), Rice(), Lentils(), Coffee(),
         Recipe("Chicken and rice bowl", GapRole.Meal, 520, 38, 6, 900), Recipe("Lentil soup", GapRole.Meal, 280, 16, 12, 800)];

    private static void AssertPractical(GapSuggestion s)
    {
        foreach (var i in s.Items)
        {
            Assert.True(i.Multiple >= P.MinPortionFraction, $"{i.Candidate.Name} x{i.Multiple} is under the minimum portion");
            Assert.True(i.Candidate.IsRecipe || i.Amount >= P.MinPortionGrams, $"{i.Candidate.Name} {i.Amount} g is a token amount");
            Assert.True(i.Candidate.IsRecipe || i.Amount <= P.MaxPortionGrams);
        }
    }

    // ── Situations ─────────────────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData(500, GapSituation.Open)]
    [InlineData(250, GapSituation.Open)]
    [InlineData(249, GapSituation.Near)]
    [InlineData(200, GapSituation.Near)]
    [InlineData(80, GapSituation.Near)]
    [InlineData(79, GapSituation.AtTarget)]
    [InlineData(50, GapSituation.AtTarget)]
    [InlineData(-40, GapSituation.AtTarget)]
    [InlineData(-61, GapSituation.Over)]
    [InlineData(-1200, GapSituation.Over)]
    public void The_day_is_classified_from_the_calories_left_using_the_policy_thresholds(double kcalLeft, GapSituation expected) =>
        Assert.Equal(expected, GapRecommender.Classify(kcalLeft, 2000, P));

    [Fact]
    public void Thresholds_come_from_the_policy_not_from_constants()
    {
        var generous = new GapFillPolicy { MinSnackKcal = 150 };
        Assert.Equal(GapSituation.AtTarget, GapRecommender.Classify(100, 2000, generous));
        Assert.Equal(GapSituation.Near, GapRecommender.Classify(100, 2000, P));
    }

    // ── Calories available ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public void With_500_kcal_left_and_protein_short_it_suggests_realistic_protein_rich_meals_or_snacks()
    {
        var results = GapRecommender.Suggest(Needs(500, protein: 40), EverydayPool(), GapMode.BestMatch, NoContext, P);

        Assert.NotEmpty(results);
        Assert.All(results, AssertPractical);
        Assert.All(results, s => Assert.True(s.Added.Calories <= 500 * (1 + P.CalorieSlackPct), $"{s.Added.Calories} kcal"));
        var top = results[0];
        Assert.True(top.Added.Protein >= 15, $"top suggestion adds {top.Added.Protein} g protein");
        Assert.Contains(top.Reasons, r => r.Code == "protein" && r.Text.Contains($"Adds about {GapExplainer.Fmt(top.Added.Protein)} g protein"));
        Assert.Contains(top.Reasons, r => r.Code == "calories");
        // Coffee has no meaningful nutrition for the gaps, so it is never suggested.
        Assert.DoesNotContain(results, s => s.Items.Any(i => i.Candidate.Name.StartsWith("Coffee")));
    }

    [Fact]
    public void With_200_kcal_left_and_fiber_short_it_suggests_snack_sized_fiber_sources_not_meals()
    {
        var results = GapRecommender.Suggest(Needs(200, protein: 10, fiber: 18), EverydayPool(), GapMode.BestMatch, NoContext, P);

        Assert.NotEmpty(results);
        Assert.All(results, AssertPractical);
        Assert.All(results, s =>
        {
            Assert.NotEqual(GapCategory.Meal, s.Category);
            Assert.True(s.Added.Calories <= 200 * (1 + P.CalorieSlackPct), $"{s.Added.Calories} kcal");
        });
        Assert.True(results[0].Added.Fiber >= 3.0, $"top suggestion adds {results[0].Added.Fiber} g fiber");
        Assert.Contains(results[0].Reasons, r => r.NutrientId == NutrientIds.Fiber);
    }

    [Fact]
    public void With_50_kcal_left_nothing_is_added()
    {
        var needs = Needs(50);
        Assert.Equal(GapSituation.AtTarget, GapRecommender.Classify(needs, P));
        foreach (var mode in Enum.GetValues<GapMode>())
            Assert.Empty(GapRecommender.Suggest(needs, EverydayPool(), mode, NoContext, P));
        Assert.Empty(GapRecommender.AvailableModes(needs, EverydayPool(), NoContext, P));
    }

    [Fact]
    public void When_1200_kcal_over_nothing_is_added_even_though_micronutrients_are_short()
    {
        var needs = Needs(-1200, protein: 60, fiber: 24);
        Assert.Equal(GapSituation.Over, GapRecommender.Classify(needs, P));
        foreach (var mode in Enum.GetValues<GapMode>())
            Assert.Empty(GapRecommender.Suggest(needs, EverydayPool(), mode, NoContext, P));
        Assert.Empty(GapRecommender.AvailableModes(needs, EverydayPool(), NoContext, P));
    }

    // ── Nutritional reasoning ──────────────────────────────────────────────────────────────────────

    [Fact]
    public void When_the_protein_goal_is_met_it_never_claims_protein_and_still_serves_the_fiber_gap()
    {
        var results = GapRecommender.Suggest(Needs(350, protein: -5, fiber: 18), EverydayPool(), GapMode.BestMatch, NoContext, P);

        Assert.NotEmpty(results);
        Assert.All(results, s =>
        {
            Assert.DoesNotContain(s.Reasons, r => r.Code == "protein");
            Assert.DoesNotContain(s.Effects, e => e.NutrientId == NutrientIds.Protein);
        });
        Assert.Contains(results, s => s.Added.Fiber >= 3);
    }

    [Fact]
    public void When_every_goal_is_met_there_is_nothing_to_fill_even_with_calories_left()
    {
        Assert.Empty(GapRecommender.Suggest(Needs(600, protein: -10, fiber: -2), EverydayPool(), GapMode.BestMatch, NoContext, P));
    }

    [Fact]
    public void A_nutrient_with_incomplete_data_is_not_called_a_gap_and_is_not_ranked_on()
    {
        // Fiber is "short" only because today's logged foods don't list it: it must not drive or be claimed in suggestions.
        var needs = Needs(400, protein: 30, fiber: 20, fiberKnown: false);
        Assert.DoesNotContain(GapRecommender.OpenNeeds(needs, P), n => n.NutrientId == NutrientIds.Fiber);

        var results = GapRecommender.Suggest(needs, EverydayPool(), GapMode.BestMatch, NoContext, P);
        Assert.NotEmpty(results);
        Assert.All(results, s =>
        {
            Assert.DoesNotContain(s.Reasons, r => r.NutrientId == NutrientIds.Fiber);
            Assert.DoesNotContain(s.Effects, e => e.NutrientId == NutrientIds.Fiber);
        });

        // With nothing evaluable left to fill there is nothing to say.
        var onlyUnknown = new List<GapTarget> { new(NutrientIds.Energy, 400, 2000, TargetKind.Goal, 4), new(NutrientIds.Fiber, 20, 28, TargetKind.Goal, 0.8, Evaluable: false) };
        Assert.Empty(GapRecommender.Suggest(onlyUnknown, EverydayPool(), GapMode.BestMatch, NoContext, P));
    }

    [Fact]
    public void A_candidate_never_gets_credit_for_a_nutrient_it_has_no_value_for()
    {
        // The "mystery bar" has no fiber figure: unknown is not zero, but it also cannot be credited as fiber.
        var mystery = Food("Mystery bar", FoodGroup.Grain, 40, "1 bar (40 g)", 180, 4, fiber: null);
        var results = GapRecommender.Suggest(Needs(300, protein: 5, fiber: 20), [mystery, Apple()], GapMode.BestMatch, NoContext, P);
        Assert.All(results, s => Assert.DoesNotContain(s.Items, i => i.Candidate.Name == "Mystery bar"));
    }

    [Fact]
    public void An_exceeded_sodium_limit_is_never_pushed_further()
    {
        // 300 mg over the limit already: only foods adding (essentially) no sodium may be suggested.
        var needs = Needs(450, protein: 40, fiber: 15, sodiumRemaining: -300);
        var results = GapRecommender.Suggest(needs, EverydayPool(), GapMode.BestMatch, NoContext, P);

        var tolerance = P.ExceededLimitTolerancePct * 2300;
        Assert.All(results, s => Assert.True(s.Added.Get(NutrientIds.Sodium) <= tolerance + 1e-9, $"adds {s.Added.Get(NutrientIds.Sodium)} mg sodium"));
        Assert.DoesNotContain(results, s => s.Items.Any(i => i.Candidate.Name.StartsWith("Chicken and rice"))); // 900 mg
    }

    [Fact]
    public void A_limit_that_is_nearly_used_up_excludes_candidates_with_unknown_values_for_it()
    {
        var unknownSodium = Food("Sandwich", FoodGroup.Grain, 200, "1 sandwich (200 g)", 300, 20, 4, sodium: null, role: GapRole.Snack);
        var known = Food("Rice cake with peanut butter", FoodGroup.NutsSeeds, 60, "2 cakes (60 g)", 250, 9, 4, sodium: 150);
        var needs = Needs(320, protein: 25, fiber: 10, sodiumRemaining: 300); // 13 % of the limit left = near
        var results = GapRecommender.Suggest(needs, [unknownSodium, known], GapMode.BestMatch, NoContext, P);
        Assert.DoesNotContain(results, s => s.Items.Any(i => i.Candidate.Name == "Sandwich"));
        Assert.Contains(results, s => s.Items.Any(i => i.Candidate.Name.StartsWith("Rice cake")));
    }

    // ── Portions ───────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Token_portions_are_never_suggested_however_dense_they_are()
    {
        // 5 g of a very dense food (a teaspoon of seeds) can mathematically close a gap but isn't a serving.
        var teaspoon = Food("Chia seeds, 1 tsp", FoodGroup.NutsSeeds, 5, "1 tsp (5 g)", 24, 0.8, 2.0);
        var tiny = Food("Dried herb", FoodGroup.Vegetable, 3, "1 tsp (3 g)", 8, 0.3, 1.1);
        Assert.Empty(GapRecommender.Multiples(teaspoon, P));
        Assert.Empty(GapRecommender.Multiples(tiny, P));
        Assert.Empty(GapRecommender.Suggest(Needs(300, 30, 20), [teaspoon, tiny], GapMode.BestMatch, NoContext, P));
    }

    [Fact]
    public void Quantities_are_multiples_of_a_real_portion_with_half_steps_only_for_non_countable_foods()
    {
        Assert.Equal([1.0, 2.0], GapRecommender.Multiples(Egg(), P)); // whole eggs only
        Assert.Equal([0.5, 1.0, 1.5, 2.0], GapRecommender.Multiples(Broccoli(), P));
        Assert.Equal([0.5, 1.0, 1.5, 2.0], GapRecommender.Multiples(Recipe("Soup", GapRole.Meal, 300, 15, 8), P));
        // A 20 g portion can't be halved to 10 g (under the minimum amount), and 2x stays within limits.
        var small = Food("Cheese stick", FoodGroup.Dairy, 20, "1 stick (20 g)", 70, 5, 0);
        Assert.Equal([1.0, 1.5, 2.0], GapRecommender.Multiples(small, P));
        // A pantry item with only 1.2 portions left can't be suggested at 1.5 or 2.
        var limited = Broccoli(GapOrigin.Pantry) with { MaxMultiple = 1.2 };
        Assert.Equal([0.5, 1.0], GapRecommender.Multiples(limited, P));
    }

    [Fact]
    public void A_filler_item_cannot_ride_along_in_a_combination_just_to_use_up_calories()
    {
        // Grapes add calories (which would nudge a pair ahead of yogurt alone) but nothing the day is short on.
        var grapes = Food("Grapes", FoodGroup.Fruit, 150, "1 cup (150 g)", 104, 1.1, 1.4, 3);
        var results = GapRecommender.Suggest(Needs(300, protein: 25, fiber: 2), [Yogurt(), grapes], GapMode.BestMatch, NoContext, P);

        Assert.NotEmpty(results);
        Assert.All(results, s => Assert.DoesNotContain(s.Items, i => i.Candidate.Name == "Grapes"));
    }

    [Fact]
    public void Every_item_in_every_suggestion_covers_a_meaningful_share_of_something_missing()
    {
        var needs = Needs(450, protein: 35, fiber: 16);
        var open = GapRecommender.OpenNeeds(needs, P);
        foreach (var s in GapRecommender.Suggest(needs, EverydayPool(), GapMode.BestMatch, NoContext, P))
            foreach (var i in s.Items)
                Assert.Contains(open, n => Math.Min(i.Nutrients.Get(n.NutrientId), n.Remaining) / n.Remaining >= P.MinContributionShare - 1e-9);
    }

    // ── Meal coherence ─────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Meals_are_a_saved_recipe_or_a_main_with_sides_never_an_arbitrary_mix()
    {
        var results = GapRecommender.Suggest(Needs(650, protein: 45, fiber: 20), EverydayPool(), GapMode.Meal, NoContext, P);

        Assert.NotEmpty(results);
        Assert.All(results, s =>
        {
            Assert.Equal(GapCategory.Meal, s.Category);
            var roles = s.Items.Select(i => i.Candidate.Role).ToList();
            var recipeMeal = s.Items.Count == 1 && roles[0] == GapRole.Meal;
            var mainWithSides = roles.Count(r => r == GapRole.Main) == 1 && roles.Count(r => r == GapRole.Side) == roles.Count - 1 && roles.Count is 2 or 3;
            Assert.True(recipeMeal || mainWithSides, "not a coherent meal: " + string.Join(" + ", s.Items.Select(i => i.Candidate.Name)));
            Assert.DoesNotContain(roles, r => r is GapRole.Snack or GapRole.Ingredient);
        });
    }

    [Fact]
    public void Snack_pairs_use_compatible_groups_and_never_mix_raw_vegetables_with_yogurt()
    {
        var pool = new List<GapCandidate> { Yogurt(), Banana(), Almonds(), Broccoli(), Rice(), Egg() };
        var results = GapRecommender.Suggest(Needs(300, protein: 25, fiber: 15), pool, GapMode.QuickSnack, NoContext, P);

        Assert.NotEmpty(results);
        foreach (var s in results.Where(s => s.Items.Count == 2))
            Assert.True(GapRoles.Compatible(s.Items[0].Candidate.Group, s.Items[1].Candidate.Group),
                $"{s.Items[0].Candidate.Name} + {s.Items[1].Candidate.Name}");
        Assert.DoesNotContain(results, s => s.Items.Any(i => i.Candidate.Role == GapRole.Side)); // quick snacks are snack foods
    }

    [Fact]
    public void A_pair_you_have_eaten_together_is_allowed_and_preferred()
    {
        var oats = Food("Rice cakes", FoodGroup.Grain, 18, "2 cakes (18 g)", 70, 1.5, 0.8, 5, role: GapRole.Snack);
        var pb = Food("Peanut butter", FoodGroup.NutsSeeds, 16, "1 tbsp (16 g)", 95, 4, 1, 70);
        var pool = new List<GapCandidate> { oats, pb };
        var together = new GapContext(CoEaten: new HashSet<string> { GapContext.PairKey(oats.Key, pb.Key) });

        // Grain + nuts isn't in the generic compatibility table, so without history there's no pair.
        Assert.DoesNotContain(GapRecommender.Suggest(Needs(400, 20, 12), pool, GapMode.QuickSnack, NoContext, P), s => s.Items.Count == 2);
        // With history the pair is offered.
        var results = GapRecommender.Suggest(Needs(400, 20, 12), pool, GapMode.QuickSnack, together, P);
        Assert.Contains(results, s => s.Items.Count == 2);
    }

    // ── Modes change the pool and the constraints ──────────────────────────────────────────────────

    [Fact]
    public void Each_mode_changes_the_candidate_pool_or_constraints()
    {
        var pool = EverydayPool();
        pool = pool.Select(c => c.Key == "f:Greek yogurt, plain nonfat" ? c with { Origin = c.Origin | GapOrigin.Pantry } : c).ToList();
        var needs = Needs(650, protein: 45, fiber: 20);

        var recipes = GapRecommender.Suggest(needs, pool, GapMode.SavedRecipes, NoContext, P);
        Assert.NotEmpty(recipes);
        Assert.All(recipes, s => Assert.All(s.Items, i => Assert.True(i.Candidate.IsRecipe)));

        var pantry = GapRecommender.Suggest(needs, pool, GapMode.Pantry, NoContext, P);
        Assert.NotEmpty(pantry);
        Assert.All(pantry, s => Assert.All(s.Items, i => Assert.True(i.Candidate.Origin.HasFlag(GapOrigin.Pantry))));

        var meals = GapRecommender.Suggest(needs, pool, GapMode.Meal, NoContext, P);
        Assert.All(meals, s => Assert.Equal(GapCategory.Meal, s.Category));

        var snacks = GapRecommender.Suggest(needs, pool, GapMode.QuickSnack, NoContext, P);
        Assert.NotEmpty(snacks);
        Assert.All(snacks, s => { Assert.Equal(GapCategory.Snack, s.Category); Assert.True(s.Added.Calories <= P.MaxSnackKcal); });

        var best = GapRecommender.Suggest(needs, pool, GapMode.BestMatch, NoContext, P);
        Assert.NotEqual(recipes.Select(s => s.Items[0].Candidate.Key), best.Select(s => s.Items[0].Candidate.Key));
    }

    [Fact]
    public void Pantry_mode_with_an_empty_pantry_is_empty_and_not_offered()
    {
        var pool = EverydayPool().Select(c => c with { Origin = c.Origin & ~GapOrigin.Pantry }).ToList();
        var needs = Needs(500);
        Assert.Empty(GapRecommender.Suggest(needs, pool, GapMode.Pantry, NoContext, P));
        Assert.DoesNotContain(GapRecommender.AvailableModes(needs, pool, NoContext, P), m => m.Mode == GapMode.Pantry);
    }

    [Fact]
    public void A_rich_pantry_yields_pantry_suggestions_and_offers_the_mode()
    {
        var pool = new List<GapCandidate> { Chicken(GapOrigin.Pantry), Broccoli(GapOrigin.Pantry), Yogurt(GapOrigin.Pantry), Almonds(GapOrigin.Pantry), Banana() };
        var needs = Needs(550, protein: 45, fiber: 18);
        var modes = GapRecommender.AvailableModes(needs, pool, NoContext, P);
        Assert.Contains(modes, m => m.Mode == GapMode.Pantry && m.Count > 0);

        var results = GapRecommender.Suggest(needs, pool, GapMode.Pantry, NoContext, P);
        Assert.All(results, s => Assert.All(s.Items, i => Assert.True(i.Candidate.Origin.HasFlag(GapOrigin.Pantry))));
        Assert.Contains(results, s => s.Reasons.Any(r => r.Code == "pantry"));
    }

    [Fact]
    public void Saved_recipes_mode_is_not_offered_without_suitable_recipes()
    {
        var modes = GapRecommender.AvailableModes(Needs(500), [Yogurt(), Chicken(), Broccoli(), Almonds()], NoContext, P);
        Assert.DoesNotContain(modes, m => m.Mode == GapMode.SavedRecipes);
        Assert.Contains(modes, m => m.Mode == GapMode.BestMatch);
    }

    [Fact]
    public void Meal_mode_needs_room_for_a_meal()
    {
        Assert.Empty(GapRecommender.Suggest(Needs(200, 20, 10), EverydayPool(), GapMode.Meal, NoContext, P));
        Assert.DoesNotContain(GapRecommender.AvailableModes(Needs(200, 20, 10), EverydayPool(), NoContext, P), m => m.Mode == GapMode.Meal);
    }

    // ── No suitable recommendation ─────────────────────────────────────────────────────────────────

    [Fact]
    public void When_nothing_covers_what_is_missing_it_returns_nothing_rather_than_padding()
    {
        var pool = new List<GapCandidate> { Coffee(), Food("Lettuce leaf", FoodGroup.Vegetable, 36, "1 cup (36 g)", 5, 0.5, 0.5, 10) };
        Assert.Empty(GapRecommender.Suggest(Needs(500, protein: 40, fiber: 18), pool, GapMode.BestMatch, NoContext, P));
    }

    [Fact]
    public void It_returns_fewer_than_three_when_fewer_are_good()
    {
        var results = GapRecommender.Suggest(Needs(250, protein: 20, fiber: 4), [Yogurt(), Coffee()], GapMode.BestMatch, NoContext, P);
        Assert.InRange(results.Count, 1, 2);
        Assert.All(results, s => Assert.DoesNotContain(s.Items, i => i.Candidate.Name.StartsWith("Coffee")));
    }

    [Fact]
    public void Results_are_deterministic()
    {
        var a = GapRecommender.Suggest(Needs(550), EverydayPool(), GapMode.BestMatch, NoContext, P);
        var b = GapRecommender.Suggest(Needs(550), EverydayPool().AsEnumerable().Reverse().ToList(), GapMode.BestMatch, NoContext, P);
        Assert.Equal(a.Select(s => string.Join("+", s.Items.Select(i => $"{i.Candidate.Key}x{i.Multiple}"))),
                     b.Select(s => string.Join("+", s.Items.Select(i => $"{i.Candidate.Key}x{i.Multiple}"))));
    }

    // ── Explanations only say what the numbers support ─────────────────────────────────────────────

    [Fact]
    public void Reasons_and_effects_match_the_calculated_amounts()
    {
        var needs = Needs(300, protein: 30, fiber: 6);
        var s = GapRecommender.Suggest(needs, [Yogurt(), Almonds(), Apple()], GapMode.BestMatch, NoContext, P)[0];

        var protein = s.Effects.SingleOrDefault(e => e.NutrientId == NutrientIds.Protein);
        if (protein is not null)
        {
            Assert.Equal(30, protein.Before);
            Assert.Equal(Math.Max(0, 30 - s.Added.Protein), protein.After, 6);
        }
        foreach (var r in s.Reasons.Where(r => r.Code is "protein" or "gap" or "source"))
        {
            var added = s.Added.Get(r.NutrientId!.Value);
            Assert.True(added > 0, $"claims a contribution of an amount it doesn't add: {r.Text}");
        }
    }

    [Fact]
    public void A_source_claim_needs_a_real_share_of_the_daily_target()
    {
        var calciumGoal = new GapTarget(NutrientIds.Calcium, 900, 1300, TargetKind.Goal, P.MicronutrientWeight);
        var needs = Needs(300, protein: 5, fiber: 2).Append(calciumGoal).ToList();
        var milk = new GapCandidate("f:milk", ItemKind.Food, Guid.NewGuid(), null, "Milk", GapRole.Snack, FoodGroup.Dairy, GapOrigin.Frequent,
            new NutrientProfile(new Dictionary<int, double> { [NutrientIds.Energy] = 122, [NutrientIds.Protein] = 8, [NutrientIds.Calcium] = 300 }), 244, "g", "1 cup (244 g)");
        var s = GapRecommender.Suggest(needs, [milk], GapMode.BestMatch, NoContext, P).Single();
        var source = s.Reasons.Single(r => r.Code == "source");
        Assert.Contains("calcium", source.Text);
        Assert.Contains($"{GapExplainer.Fmt(300 * s.Items[0].Multiple / 1300 * 100)}%", source.Text);
    }

    // ── Swaps and next-day ideas ───────────────────────────────────────────────────────────────────

    [Fact]
    public void Over_target_it_offers_a_lighter_swap_for_a_planned_meal_that_keeps_what_you_are_short_on()
    {
        var needs = Needs(-600, protein: 30, fiber: 10);
        var planned = new GapPlanned(Guid.NewGuid(), "Lasagna", GapCategory.Meal, Nutrients(780, 32, 4, 1400));
        var swaps = GapRecommender.Swaps(needs, [planned], EverydayPool(), P);

        var swap = Assert.Single(swaps);
        Assert.True(swap.To.Candidate.IsRecipe);
        Assert.True(swap.SavesKcal >= P.SwapMinSavingsKcal, $"saves {swap.SavesKcal}");
        Assert.True(swap.To.Nutrients.Calories >= planned.Nutrients.Calories * P.SwapMinKeepShare, "still a real replacement");
        Assert.Contains(swap.Reasons, r => r.Code == "saves");
        // It never trades away what you're short on: protein within 10 % or better, fiber the same or better.
        Assert.True(swap.To.Nutrients.Protein >= 0.9 * Math.Min(planned.Nutrients.Protein, 30));
        Assert.True(swap.To.Nutrients.Fiber >= planned.Nutrients.Fiber);
    }

    [Fact]
    public void A_swap_that_loses_the_nutrient_you_are_short_on_is_not_offered()
    {
        var needs = Needs(-500, protein: 40, fiber: 5);
        var planned = new GapPlanned(Guid.NewGuid(), "Protein plate", GapCategory.Meal, Nutrients(700, 55, 3));
        var weakMeals = new List<GapCandidate> { Recipe("Veggie wrap", GapRole.Meal, 400, 9, 5) };
        Assert.Empty(GapRecommender.Swaps(needs, [planned], weakMeals, P));
    }

    [Fact]
    public void Small_planned_items_and_trivial_savings_are_not_swapped()
    {
        var needs = Needs(-300);
        var small = new GapPlanned(Guid.NewGuid(), "Apple", GapCategory.Snack, Nutrients(95, 0.5, 4.4));
        Assert.Empty(GapRecommender.Swaps(needs, [small], EverydayPool(), P));
    }

    [Fact]
    public void Next_day_ideas_are_real_sources_of_what_ran_short()
    {
        var needs = Needs(-800, protein: 10, fiber: 20);
        var tips = GapRecommender.NextDay(needs, EverydayPool(), P);

        var fiber = Assert.Single(tips, t => t.NutrientId == NutrientIds.Fiber);
        Assert.All(fiber.Items, t => Assert.True(t.DailyShare >= P.TipMinDailyShare));
        Assert.Contains(fiber.Items, t => t.Candidate.Name.StartsWith("Lentil"));
        Assert.DoesNotContain(fiber.Items, t => t.Candidate.Name.StartsWith("Coffee"));
    }

    // ── Review regressions ─────────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData("Broccoli, cooked, boiled, drained, without salt", "Vegetables and Vegetable Products", FoodGroup.Vegetable, GapRole.Side)]
    [InlineData("Lentils, mature seeds, cooked, boiled, without salt", "Legumes and Legume Products", FoodGroup.Legume, GapRole.Side)]
    [InlineData("Tuna, light, canned in water, drained solids", "Finfish and Shellfish Products", FoodGroup.Protein, GapRole.Main)]
    [InlineData("Fish, salmon, Atlantic, farmed, cooked, dry heat", "Finfish and Shellfish Products", FoodGroup.Protein, GapRole.Main)]
    [InlineData("Salmon, canned in oil, drained", null, FoodGroup.Protein, GapRole.Main)]
    [InlineData("Cereals, oats, regular and quick, not fortified, cooked with water", "Breakfast Cereals", FoodGroup.Cereal, GapRole.Snack)]
    [InlineData("Bananas, raw", "Fruits and Fruit Juices", FoodGroup.Fruit, GapRole.Snack)]
    [InlineData("Apples, raw, with skin", "Fruits and Fruit Juices", FoodGroup.Fruit, GapRole.Snack)]
    [InlineData("Milk, reduced fat, fluid, 2% milkfat, with added vitamin A and vitamin D", "Dairy and Egg Products", FoodGroup.Dairy, GapRole.Snack)]
    [InlineData("Nuts, almonds", "Nut and Seed Products", FoodGroup.NutsSeeds, GapRole.Snack)]
    [InlineData("Rice, brown, long-grain, cooked", "Cereal Grains and Pasta", FoodGroup.Grain, GapRole.Side)]
    [InlineData("Peas, sugar snap, raw", "Vegetables and Vegetable Products", FoodGroup.Vegetable, GapRole.Side)]
    [InlineData("Soup, chicken noodle, canned, condensed", "Soups, Sauces, and Gravies", FoodGroup.Mixed, GapRole.Snack)]
    [InlineData("Pizza, cheese, regular crust", null, FoodGroup.Mixed, GapRole.Snack)]
    [InlineData("Beverages, coffee, brewed, prepared with tap water", "Beverages", FoodGroup.Other, GapRole.Ingredient)]
    [InlineData("Oil, olive, salad or cooking", "Fats and Oils", FoodGroup.Other, GapRole.Ingredient)]
    [InlineData("Orange juice, raw", "Fruits and Fruit Juices", FoodGroup.Other, GapRole.Ingredient)]
    [InlineData("Salad dressing, ranch", "Fats and Oils", FoodGroup.Other, GapRole.Ingredient)]
    public void Real_USDA_names_are_classified_by_the_food_itself_not_by_words_in_its_modifiers_or_category(string name, string? category, FoodGroup group, GapRole role) =>
        Assert.Equal((group, role), GapRoles.ClassifyFood(name, category));

    [Fact]
    public void A_side_food_is_never_suggested_on_its_own()
    {
        var oatmeal = Food("Oatmeal, cooked", FoodGroup.Cereal, 234, "1 cup (234 g)", 166, 6, 4, 9);
        var pool = new List<GapCandidate> { oatmeal, Rice(), Broccoli(), Lentils(), Food("Carrots, cooked", FoodGroup.Vegetable, 156, "1 cup (156 g)", 55, 1.2, 4.7, 90) };
        foreach (var kcal in new[] { 1500.0, 900, 500, 300 })
            foreach (var mode in Enum.GetValues<GapMode>())
                Assert.DoesNotContain(GapRecommender.Suggest(Needs(kcal, 60, 20), pool, mode, NoContext, P),
                    s => s.Items.Count == 1 && s.Items[0].Candidate is { Role: GapRole.Side, IsRecipe: false });

        // A saved side-dish recipe is a real side dish and may be suggested alone.
        var salad = Recipe("Side salad", GapRole.Side, 140, 4, 6, 200);
        Assert.Contains(GapRecommender.Suggest(Needs(300, 10, 12), [salad], GapMode.BestMatch, NoContext, P), s => s.Category == GapCategory.Side);
    }

    [Fact]
    public void A_main_is_only_paired_with_a_vegetable_grain_or_legume_never_a_breakfast_cereal_or_two_vegetables()
    {
        var oatmeal = Food("Oatmeal, cooked", FoodGroup.Cereal, 234, "1 cup (234 g)", 166, 6, 4, 9);
        var salmon = Food("Salmon, cooked", FoodGroup.Protein, 150, "1 fillet (150 g)", 280, 38, 0, 90);
        var carrots = Food("Carrots, cooked", FoodGroup.Vegetable, 156, "1 cup (156 g)", 55, 1.2, 4.7, 90);
        var pool = new List<GapCandidate> { salmon, oatmeal, carrots, Broccoli(), Rice() };

        var meals = GapRecommender.Suggest(Needs(1200, 60, 22), pool, GapMode.Meal, NoContext, P);
        Assert.NotEmpty(meals);
        Assert.DoesNotContain(meals, s => s.Items.Any(i => i.Candidate.Group == FoodGroup.Cereal));
        Assert.All(meals, s =>
        {
            var sides = s.Items.Where(i => i.Candidate.Role == GapRole.Side).Select(i => i.Candidate.Group).ToList();
            Assert.True(sides.Count == 1 || (sides.Count == 2 && GapRoles.SidePair(sides[0], sides[1])), string.Join("+", s.Items.Select(i => i.Candidate.Name)));
        });
    }

    [Fact]
    public void A_few_leaves_cannot_ride_along_in_a_meal_even_when_they_are_rich_in_a_micronutrient()
    {
        // 30 g of spinach is a real portion and covers most of the vitamin K still needed, but at 7 kcal it is garnish.
        var spinach = new GapCandidate("f:Spinach", ItemKind.Food, Guid.NewGuid(), null, "Spinach, raw", GapRole.Side, FoodGroup.Vegetable, GapOrigin.Frequent,
            new NutrientProfile(new Dictionary<int, double> { [NutrientIds.Energy] = 7, [NutrientIds.Protein] = 0.9, [NutrientIds.VitaminK] = 145 }), 30, "g", "1 cup (30 g)");
        var needs = Needs(500, 40, 2).Append(new GapTarget(NutrientIds.VitaminK, 120, 120, TargetKind.Goal, P.MicronutrientWeight)).ToList();
        var results = GapRecommender.Suggest(needs, [Chicken(), spinach, Rice()], GapMode.Meal, NoContext, P);
        Assert.NotEmpty(results);
        Assert.All(results, s => Assert.DoesNotContain(s.Items, i => i.Candidate.Name.StartsWith("Spinach")));
    }

    [Fact]
    public void When_a_meal_fits_the_best_match_leads_with_it_not_a_smaller_snack()
    {
        // Two yogurts cover all of the protein a snack is expected to fill (so, judged only against its own size, they look
        // better than a meal that covers 84 % of the whole gap). Against the whole gap, and the room, the meal leads.
        var pool = new List<GapCandidate> { Yogurt(), Almonds(), Recipe("Chicken and rice bowl", GapRole.Meal, 520, 38, 6, 700) };
        var results = GapRecommender.Suggest(Needs(520, protein: 45, fiber: 2), pool, GapMode.BestMatch, NoContext, P);
        Assert.Equal(GapCategory.Meal, results[0].Category);
        Assert.Contains(results, s => s.Category == GapCategory.Snack); // the snack is still offered, just not first
    }

    [Fact]
    public void The_calorie_reason_admits_a_small_overshoot_instead_of_saying_it_fits()
    {
        var bowl = Recipe("Salmon bowl", GapRole.Meal, 540, 42, 6, 400);
        var s = GapRecommender.Suggest(Needs(520, protein: 40, fiber: 4), [bowl], GapMode.BestMatch, NoContext, P).Single();
        Assert.True(s.Added.Calories > 520); // within the 5 % rounding room
        var calories = s.Reasons.Single(r => r.Code == "calories");
        Assert.Contains("over your remaining", calories.Text);
        Assert.DoesNotContain("Fits within", calories.Text);
    }

    [Fact]
    public void Where_things_come_from_is_only_claimed_for_the_whole_suggestion_when_true_of_all_of_it()
    {
        var pool = new List<GapCandidate> { Yogurt(GapOrigin.Frequent), Banana() with { Origin = GapOrigin.None } };
        var pairs = GapRecommender.Suggest(Needs(300, protein: 20, fiber: 8), pool, GapMode.QuickSnack, NoContext, P).Where(s => s.Items.Count == 2).ToList();
        Assert.NotEmpty(pairs);
        Assert.All(pairs, s =>
        {
            Assert.DoesNotContain(s.Reasons, r => r.Code == "frequent");
            Assert.Contains(s.Reasons, r => r.Code == "frequent_some");
        });
        // A single frequent food is said plainly.
        var single = GapRecommender.Suggest(Needs(150, protein: 15, fiber: 1), [Yogurt(GapOrigin.Frequent)], GapMode.BestMatch, NoContext, P).Single();
        Assert.Contains(single.Reasons, r => r.Code == "frequent");
    }

    [Fact]
    public void A_swap_never_adds_to_a_limit_and_never_proposes_the_planned_item_itself()
    {
        var needs = Needs(-500, protein: 30, fiber: 10, sodiumRemaining: 400);
        var planned = new GapPlanned(Guid.NewGuid(), "Chicken and rice bowl", GapCategory.Meal, Nutrients(780, 40, 6, 900), Key: "r:Chicken and rice bowl");
        var saltier = Recipe("Salty noodles", GapRole.Meal, 520, 42, 8, 1500);
        var lighter = Recipe("Lentil soup", GapRole.Meal, 450, 40, 9, 600);
        var swaps = GapRecommender.Swaps(needs, [planned], [Recipe("Chicken and rice bowl", GapRole.Meal, 520, 38, 6, 700), saltier, lighter], P);

        var swap = Assert.Single(swaps);
        Assert.Equal("Lentil soup", swap.To.Candidate.Name);
        Assert.True(swap.To.Nutrients.Get(NutrientIds.Sodium) <= planned.Nutrients.Get(NutrientIds.Sodium));
    }

    [Fact]
    public void Suggestions_swaps_and_ideas_do_not_depend_on_the_order_of_the_pool()
    {
        var pool = EverydayPool();
        var reversed = pool.AsEnumerable().Reverse().ToList();
        var needs = Needs(-600, protein: 30, fiber: 14);
        var planned = new GapPlanned(Guid.NewGuid(), "Lasagna", GapCategory.Meal, Nutrients(780, 32, 4, 1400));
        Assert.Equal(GapRecommender.Swaps(needs, [planned], pool, P).Select(x => x.To.Candidate.Key + x.To.Multiple),
                     GapRecommender.Swaps(needs, [planned], reversed, P).Select(x => x.To.Candidate.Key + x.To.Multiple));
        Assert.Equal(GapRecommender.NextDay(needs, pool, P).SelectMany(t => t.Items.Select(i => i.Candidate.Key)),
                     GapRecommender.NextDay(needs, reversed, P).SelectMany(t => t.Items.Select(i => i.Candidate.Key)));
    }

    // ── Roles ──────────────────────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData("Yogurt, Greek, plain, nonfat", null, FoodGroup.Dairy, GapRole.Snack)]
    [InlineData("Egg, whole, cooked, hard-boiled", null, FoodGroup.Egg, GapRole.Snack)]
    [InlineData("Chicken, broilers or fryers, breast meat only, cooked, roasted", null, FoodGroup.Protein, GapRole.Main)]
    [InlineData("Salmon, Atlantic, farmed, cooked", null, FoodGroup.Protein, GapRole.Main)]
    [InlineData("Broccoli, cooked, boiled", null, FoodGroup.Vegetable, GapRole.Side)]
    [InlineData("Beans, snap, green, cooked", null, FoodGroup.Vegetable, GapRole.Side)]
    [InlineData("Beans, black, mature seeds, cooked, boiled", null, FoodGroup.Legume, GapRole.Side)]
    [InlineData("Lentils, mature seeds, cooked, boiled", null, FoodGroup.Legume, GapRole.Side)]
    [InlineData("Rice, brown, long-grain, cooked", null, FoodGroup.Grain, GapRole.Side)]
    [InlineData("Almonds", null, FoodGroup.NutsSeeds, GapRole.Snack)]
    [InlineData("Peanut butter, smooth style", null, FoodGroup.NutsSeeds, GapRole.Snack)]
    [InlineData("Bananas, raw", null, FoodGroup.Fruit, GapRole.Snack)]
    [InlineData("Eggplant, cooked", null, FoodGroup.Vegetable, GapRole.Side)]
    [InlineData("Coffee, brewed", null, FoodGroup.Other, GapRole.Ingredient)]
    [InlineData("Oil, olive", null, FoodGroup.Other, GapRole.Ingredient)]
    [InlineData("Butter, salted", null, FoodGroup.Other, GapRole.Ingredient)]
    [InlineData("Sugars, granulated", null, FoodGroup.Other, GapRole.Ingredient)]
    [InlineData("Mystery item", null, FoodGroup.Other, GapRole.Ingredient)]
    public void Foods_are_classified_by_what_they_are_in_a_day_of_eating(string name, string? category, FoodGroup group, GapRole role) =>
        Assert.Equal((group, role), GapRoles.ClassifyFood(name, category));

    [Theory]
    [InlineData("Dinner", 520, GapRole.Meal)]
    [InlineData("Main Dishes, Dinner", 480, GapRole.Meal)]
    [InlineData("Salad", 150, GapRole.Side)]
    [InlineData("Dessert", 200, GapRole.Snack)]
    [InlineData("Snacks", 150, GapRole.Snack)]
    [InlineData("", 450, GapRole.Meal)]      // no category: judged by size
    [InlineData("", 150, GapRole.Snack)]
    [InlineData("", 30, GapRole.Side)]
    public void Recipes_are_classified_from_their_categories_or_size(string categories, double kcal, GapRole role) =>
        Assert.Equal(role, GapRoles.ClassifyRecipe(categories.Split(',', StringSplitOptions.RemoveEmptyEntries), kcal, P));
}
