using NutriPlan.Application.Foods;
using NutriPlan.Application.Planning;
using NutriPlan.Domain.Diary;
using NutriPlan.Domain.Foods;
using NutriPlan.Domain.Nutrients;
using NutriPlan.Domain.Pantry;
using NutriPlan.Domain.Planning;
using NutriPlan.Domain.Recipes;

namespace NutriPlan.Application.Tests;

/// <summary>Fill the Gaps through the real service: real portions, pantry limits, data coverage, modes and the over-target day.</summary>
public class GapFillServiceTests
{
    private readonly InMemoryStore _store = new();
    private GapFillService Service() => new(_store, _store, _store, _store, _store, _store, new FoodService(_store, [], _store));
    private DateOnly Day => _store.Today;

    /// <summary>A food from per-100 g values and one household measure (e.g. "1 container" = 170 g).</summary>
    private Food AddFood(string name, double kcal, double protein, double fiber, double sodium, string? portion, double portionGrams, string? category = null, double amount = 1)
    {
        var food = new Food(name, FoodSource.UsdaSrLegacy, new NutrientProfile(new Dictionary<int, double>
        {
            [NutrientIds.Energy] = kcal, [NutrientIds.Protein] = protein, [NutrientIds.Fiber] = fiber, [NutrientIds.Sodium] = sodium,
            [NutrientIds.Carbohydrate] = 10, [NutrientIds.Fat] = 2,
        }), category: category, portions: portion is null ? [] : [new FoodPortion(portion, portionGrams, amount)]);
        _store.Foods.Add(food);
        return food;
    }

    private void Eat(Food food, double grams, MealSlot meal = MealSlot.Lunch, DateOnly? date = null) =>
        _store.Diary.Add(new DiaryEntry(date ?? Day, meal, ItemSnapshot.ForFood(food.Id, food.Name, grams, food.NutrientsFor(grams))));

    /// <summary>History on earlier days so the foods count as ones you eat.</summary>
    private void Habit(Food food, double grams, int times = 3) { for (var i = 1; i <= times; i++) Eat(food, grams, MealSlot.Snack, Day.AddDays(-i)); }

    private void Pantry(Food food, double? grams) => _store.Pantry.Add(new PantryItem(food.Name, food.Id, grams));

    private Recipe AddRecipe(string name, double kcal, double protein, double fiber, double sodium, params string[] categories)
    {
        var r = new Recipe(name, 1);
        r.SetCategories(categories);
        r.IsFavorite = false;
        r.ApplyNutrition(new RecipeNutrition(
            new NutrientProfile(new Dictionary<int, double> { [NutrientIds.Energy] = kcal, [NutrientIds.Protein] = protein, [NutrientIds.Fiber] = fiber, [NutrientIds.Sodium] = sodium }),
            new NutrientProfile(new Dictionary<int, double> { [NutrientIds.Energy] = kcal, [NutrientIds.Protein] = protein, [NutrientIds.Fiber] = fiber, [NutrientIds.Sodium] = sodium }),
            1.0, []));
        _store.Recipes.Add(r);
        return r;
    }

    // ── Real portions ──────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Portions_come_from_your_usual_amount_a_labelled_serving_or_a_natural_item_and_are_never_invented()
    {
        var policy = new GapFillPolicy();
        var yogurt = AddFood("Yogurt, Greek, plain, nonfat", 59, 10, 0, 36, "container", 170);

        var usual = GapFillService.ChoosePortion(yogurt, 170, policy)!;
        Assert.Equal(170, usual.Grams);
        Assert.Contains("container", usual.Label);
        Assert.True(usual.Countable);

        var other = GapFillService.ChoosePortion(yogurt, 90, policy)!; // you usually eat 90 g
        Assert.Equal(90, other.Grams);
        Assert.Contains("your usual", other.Label);

        var nlea = AddFood("Cereal", 380, 8, 10, 400, "NLEA serving", 40);
        Assert.Equal(40, GapFillService.ChoosePortion(nlea, null, policy)!.Grams);

        var banana = AddFood("Banana, raw", 89, 1.1, 2.6, 1, "medium (7\" to 7-7/8\" long)", 118);
        var natural = GapFillService.ChoosePortion(banana, null, policy);
        Assert.Equal(118, natural!.Grams);

        // No portion data and no history: the food can't be suggested (no 100 g fallback).
        var bare = AddFood("Mystery granola", 450, 10, 8, 20, null, 0);
        Assert.Null(GapFillService.ChoosePortion(bare, null, policy));

        // A "portion" lighter than a real serving (a teaspoon) isn't one.
        var seeds = AddFood("Chia seeds", 486, 17, 34, 16, "tsp", 5);
        Assert.Null(GapFillService.ChoosePortion(seeds, null, policy));
        Assert.Null(GapFillService.ChoosePortion(seeds, 5, policy));
    }

    [Fact]
    public async Task Suggestions_use_real_serving_sizes_never_token_amounts()
    {
        var yogurt = AddFood("Yogurt, Greek, plain, nonfat", 59, 10, 0, 36, "container", 170);
        var almonds = AddFood("Almonds", 579, 21, 12.5, 1, "oz", 28);
        var apple = AddFood("Apples, raw, with skin", 52, 0.3, 2.4, 1, "medium", 182);
        var broccoli = AddFood("Broccoli, cooked, boiled", 35, 2.4, 3.3, 41, "cup", 156);
        var coffee = AddFood("Coffee, brewed", 1, 0.1, 0, 2, "cup", 237);
        foreach (var f in new[] { yogurt, almonds, apple, broccoli, coffee }) Habit(f, f == coffee ? 237 : 100);
        Habit(coffee, 5); // even a history of tiny logged amounts must not make tiny suggestions

        var report = await Service().SuggestAsync(new GapFillRequest(Day));

        Assert.Equal("Open", report.Situation);
        Assert.NotEmpty(report.Suggestions);
        foreach (var item in report.Suggestions.SelectMany(s => s.Items))
        {
            Assert.True(item.Kind == "Recipe" || item.Amount >= 15, $"{item.Name}: {item.Amount} g");
            Assert.False(string.IsNullOrWhiteSpace(item.Portion));
            Assert.DoesNotContain("Coffee", item.Name);
        }
        Assert.All(report.Suggestions, s => Assert.NotEmpty(s.Reasons));
    }

    // ── Pantry ─────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Pantry_suggestions_never_exceed_what_you_have_and_the_mode_only_uses_pantry_foods()
    {
        var yogurt = AddFood("Yogurt, Greek, plain, nonfat", 59, 10, 0, 36, "container", 170);
        var almonds = AddFood("Almonds", 579, 21, 12.5, 1, "oz", 28);
        var apple = AddFood("Apples, raw, with skin", 52, 0.3, 2.4, 1, "medium", 182);
        Pantry(yogurt, 170);   // exactly one container
        Pantry(almonds, 40);   // 1.4 portions
        Habit(apple, 182);     // eaten often, not in the pantry

        var report = await Service().SuggestAsync(new GapFillRequest(Day, Mode: GapMode.Pantry));

        Assert.Equal("Pantry", report.Mode);
        Assert.NotEmpty(report.Suggestions);
        var have = new Dictionary<Guid, double> { [yogurt.Id] = 170, [almonds.Id] = 40 };
        foreach (var item in report.Suggestions.SelectMany(s => s.Items))
        {
            Assert.NotNull(item.FoodId);
            Assert.True(have.ContainsKey(item.FoodId!.Value), $"{item.Name} is not in the pantry");
            Assert.True(item.Amount <= have[item.FoodId!.Value] + 1e-9, $"{item.Name}: suggests {item.Amount} g, you have {have[item.FoodId!.Value]} g");
        }
    }

    [Fact]
    public async Task With_an_empty_pantry_the_pantry_mode_is_not_offered_and_explains_itself()
    {
        var yogurt = AddFood("Yogurt, Greek, plain, nonfat", 59, 10, 0, 36, "container", 170);
        Habit(yogurt, 170);

        var report = await Service().SuggestAsync(new GapFillRequest(Day, Mode: GapMode.Pantry));
        Assert.Empty(report.Suggestions);
        Assert.Equal("NoPantry", report.EmptyReason);
        Assert.DoesNotContain(report.AvailableModes, m => m.Mode == "Pantry");

        var best = await Service().SuggestAsync(new GapFillRequest(Day));
        Assert.Contains(best.AvailableModes, m => m.Mode == "BestMatch");
    }

    [Fact]
    public async Task A_pantry_item_with_too_little_left_is_not_a_pantry_suggestion()
    {
        var yogurt = AddFood("Yogurt, Greek, plain, nonfat", 59, 10, 0, 36, "container", 170);
        Pantry(yogurt, 40); // under half a container
        var report = await Service().SuggestAsync(new GapFillRequest(Day, Mode: GapMode.Pantry));
        Assert.Empty(report.Suggestions);
    }

    // ── Saved recipes ──────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Recipes_only_mode_offers_saved_recipes_and_nothing_else()
    {
        var yogurt = AddFood("Yogurt, Greek, plain, nonfat", 59, 10, 0, 36, "container", 170);
        Habit(yogurt, 170);
        AddRecipe("Chicken and rice bowl", 520, 38, 6, 700, "Dinner");
        AddRecipe("Lentil soup", 280, 16, 12, 650, "Soup");

        var recipesOnly = await Service().SuggestAsync(new GapFillRequest(Day, RecipesOnly: true));
        Assert.Equal("SavedRecipes", recipesOnly.Mode);
        Assert.NotEmpty(recipesOnly.Suggestions);
        Assert.All(recipesOnly.Suggestions.SelectMany(s => s.Items), i => Assert.Equal("Recipe", i.Kind));
        Assert.All(recipesOnly.Suggestions, s => Assert.Contains(s.Reasons, r => r.Code == "recipe"));

        var best = await Service().SuggestAsync(new GapFillRequest(Day));
        Assert.Contains(best.AvailableModes, m => m.Mode == "SavedRecipes");
        Assert.Contains(best.Suggestions.SelectMany(s => s.Items), i => i.Kind == "Food");
    }

    [Fact]
    public async Task Without_saved_recipes_that_mode_is_hidden_and_explained()
    {
        var yogurt = AddFood("Yogurt, Greek, plain, nonfat", 59, 10, 0, 36, "container", 170);
        Habit(yogurt, 170);
        var report = await Service().SuggestAsync(new GapFillRequest(Day, RecipesOnly: true));
        Assert.Empty(report.Suggestions);
        Assert.Equal("NoRecipes", report.EmptyReason);
        Assert.DoesNotContain(report.AvailableModes, m => m.Mode == "SavedRecipes");
    }

    // ── Over target / at target ────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Over_target_it_adds_nothing_states_the_overage_plainly_and_offers_swaps_and_tomorrow_ideas()
    {
        var yogurt = AddFood("Yogurt, Greek, plain, nonfat", 59, 10, 0, 36, "container", 170);
        var lentils = AddFood("Lentils, mature seeds, cooked, boiled", 116, 9, 7.9, 2, "cup", 198);
        Habit(yogurt, 170); Habit(lentils, 198);
        var heavy = AddFood("Pizza", 270, 11, 0.5, 600, "slice", 107);
        Eat(heavy, 1185); // ~3,200 kcal
        var lasagna = AddRecipe("Lasagna", 780, 32, 4, 1400, "Dinner");
        AddRecipe("Chicken and rice bowl", 520, 38, 6, 700, "Dinner");
        _store.Plan.Add(new PlanEntry(Day, MealSlot.Dinner, ItemSnapshot.ForRecipe(lasagna.Id, lasagna.Name, 1, lasagna.NutritionPerServing)));

        var report = await Service().SuggestAsync(new GapFillRequest(Day));

        Assert.Equal("Over", report.Situation);
        Assert.Empty(report.Suggestions);
        Assert.Empty(report.AvailableModes);
        Assert.True(report.Remaining.Calories < -1000, $"remaining {report.Remaining.Calories}"); // shown signed, not clamped to zero
        Assert.Contains("above today's target", report.Message);
        Assert.Contains("no need to add anything", report.Message);
        Assert.DoesNotContain("over budget", report.Message, StringComparison.OrdinalIgnoreCase);

        var swap = Assert.Single(report.Swaps);
        Assert.Equal("Lasagna", swap.FromName);
        Assert.True(swap.SavesCalories >= 100);
        Assert.NotNull(swap.To.RecipeId);
        Assert.NotEmpty(report.NextDay);
    }

    [Fact]
    public async Task At_target_it_adds_nothing()
    {
        var food = AddFood("Rice, cooked", 130, 2.7, 0.4, 1, "cup", 158);
        Habit(food, 158);
        Eat(AddFood("Big lunch", 100, 5, 1, 10, null, 0), 1960); // 1,960 kcal of 2,000
        var report = await Service().SuggestAsync(new GapFillRequest(Day));
        Assert.Equal("AtTarget", report.Situation);
        Assert.Empty(report.Suggestions);
        Assert.Equal("AtTarget", report.EmptyReason);
    }

    // ── Data completeness ──────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task A_nutrient_missing_from_most_of_todays_calories_is_not_called_a_gap_or_used_for_ranking()
    {
        var yogurt = AddFood("Yogurt, Greek, plain, nonfat", 59, 10, 0, 36, "container", 170);
        var apple = AddFood("Apples, raw, with skin", 52, 0.3, 2.4, 1, "medium", 182);
        Habit(yogurt, 170); Habit(apple, 182);
        // 900 kcal logged as a quick entry: no fiber figure at all.
        _store.Diary.Add(new DiaryEntry(Day, MealSlot.Lunch, ItemSnapshot.QuickCalories("Restaurant lunch", 900, 30, 90, 40)));

        var report = await Service().SuggestAsync(new GapFillRequest(Day));

        var fiber = report.Gaps.Single(g => g.NutrientId == NutrientIds.Fiber);
        Assert.False(fiber.DataComplete);
        Assert.Contains(report.DataNotes, n => n.Contains("fiber"));
        Assert.All(report.Suggestions, s =>
        {
            Assert.DoesNotContain(s.Reasons, r => r.NutrientId == NutrientIds.Fiber);
            Assert.DoesNotContain(s.Effects, e => e.NutrientId == NutrientIds.Fiber);
        });
    }

    [Fact]
    public void Data_coverage_is_the_share_of_logged_calories_whose_food_lists_the_nutrient()
    {
        var known = ItemSnapshot.ForFood(Guid.NewGuid(), "A", 100, new NutrientProfile(new Dictionary<int, double> { [NutrientIds.Energy] = 300, [NutrientIds.Fiber] = 5 }));
        var unknown = ItemSnapshot.QuickCalories("B", 100);
        var coverage = GapFillService.DataCoverage([known, unknown]);
        Assert.Equal(0.75, coverage(NutrientIds.Fiber), 6);
        Assert.Equal(1.0, GapFillService.DataCoverage([])(NutrientIds.Fiber)); // nothing logged: nothing missing
    }

    // ── Limits ─────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task When_sodium_is_already_over_its_limit_suggestions_do_not_add_more()
    {
        var yogurt = AddFood("Yogurt, Greek, plain, nonfat", 59, 10, 0, 36, "container", 170);
        var soup = AddFood("Chicken noodle soup, canned", 40, 3, 0.4, 700, "cup", 248);
        var apple = AddFood("Apples, raw, with skin", 52, 0.3, 2.4, 1, "medium", 182);
        Habit(yogurt, 170); Habit(soup, 248); Habit(apple, 182);
        var salty = AddFood("Ramen", 436, 10, 2, 2900, null, 0);
        Eat(salty, 100); // 2,900 mg sodium against a 2,300 mg limit

        var report = await Service().SuggestAsync(new GapFillRequest(Day));

        var limit = 2300 * new GapFillPolicy().ExceededLimitTolerancePct;
        Assert.All(report.Suggestions, s =>
        {
            Assert.DoesNotContain(s.Items, i => i.Name.Contains("soup", StringComparison.OrdinalIgnoreCase));
            Assert.True(s.Items.Sum(i => i.Nutrition.Calories) > 0);
        });
        Assert.Contains(report.Gaps, g => g.NutrientId == NutrientIds.Sodium && g.Remaining < 0);
        _ = limit;
    }

    // ── Configuration ──────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Thresholds_can_be_changed_through_the_policy()
    {
        var yogurt = AddFood("Yogurt, Greek, plain, nonfat", 59, 10, 0, 36, "container", 170);
        Habit(yogurt, 170);
        Eat(AddFood("Big lunch", 100, 5, 1, 10, null, 0), 1850); // 150 kcal left
        var strict = new GapFillService(_store, _store, _store, _store, _store, _store, new FoodService(_store, [], _store),
            Microsoft.Extensions.Options.Options.Create(new GapFillPolicy { MinSnackKcal = 200 }));

        Assert.Equal("AtTarget", (await strict.SuggestAsync(new GapFillRequest(Day))).Situation);
        Assert.Equal("Near", (await Service().SuggestAsync(new GapFillRequest(Day))).Situation);
    }
}
