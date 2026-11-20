using NutriPlan.Application.Abstractions;
using NutriPlan.Application.Assistant;
using NutriPlan.Application.Diary;
using NutriPlan.Application.Foods;
using NutriPlan.Application.Pantry;
using NutriPlan.Application.Planning;
using NutriPlan.Domain.Diary;
using NutriPlan.Domain.Foods;
using NutriPlan.Domain.Planning;
using NutriPlan.Domain.Recipes;

namespace NutriPlan.Application.Tests;

public class ServiceTests
{
    private readonly InMemoryStore _store = new();

    private DiaryService Diary() => new(_store, _store, _store, _store, _store);
    private PlanService Plan() => new(_store, _store, _store, Diary(), _store, _store);

    [Fact]
    public async Task Logging_by_household_measure_converts_to_grams_and_snapshots_nutrition()
    {
        var rice = _store.AddFood("Rice, white, cooked", 130, 2.7, 28, 0.3, portions: new FoodPortion("cup", 158));
        var entry = await Diary().LogFoodAsync(new LogFoodRequest(_store.Today, MealSlot.Lunch, rice.Id, null, 1.5, "cups"));

        Assert.Equal(237, entry.Item.Grams);
        Assert.Equal(308.1, entry.Item.Nutrition.Calories, 1);

        // Editing the food later doesn't change history.
        rice.UpdateNutrients(new(new Dictionary<int, double> { [1008] = 999 }));
        var day = await Diary().GetDayAsync(_store.Today);
        Assert.Equal(308.1, day.Totals.Calories, 1);
    }

    [Fact]
    public async Task Unconvertible_amount_is_rejected_with_a_clear_message()
    {
        var chicken = _store.AddFood("Chicken breast, raw", 120, 22.5, 0, 2.6);
        var ex = await Assert.ThrowsAsync<Common.ValidationException>(() =>
            Diary().LogFoodAsync(new LogFoodRequest(_store.Today, MealSlot.Dinner, chicken.Id, null, 1, "cup")));
        Assert.Contains("can't be converted", ex.Message);
    }

    [Fact]
    public async Task Marking_a_planned_meal_eaten_logs_it_and_week_view_reflects_both()
    {
        var oats = _store.AddFood("Oats", 379, 13, 68, 6.5, portions: new FoodPortion("cup", 81));
        var planned = await Plan().AddFoodAsync(new AddPlanFoodRequest(_store.Today, MealSlot.Breakfast, oats.Id, 80, null, null));

        var logged = await Plan().MarkEatenAsync(planned.Id, 1.25);
        var week = await Plan().GetWeekAsync(_store.Today);
        var today = week.Days.Single(d => d.IsToday);

        Assert.Equal(planned.Id, logged.PlanEntryId);
        Assert.Equal(100, logged.Item.Grams);
        Assert.Equal("Eaten", today.Planned.Single().Status);
        Assert.Equal(0, today.PlannedRemaining.Calories);
        Assert.Equal(379, today.Eaten.Calories, 1);
        await Assert.ThrowsAsync<Common.ValidationException>(() => Plan().MarkEatenAsync(planned.Id));
    }

    [Fact]
    public async Task Weekly_mode_lowers_remaining_targets_after_an_overage()
    {
        _store.Targets.Calories = 2000;
        _store.Targets.BudgetMode = BudgetMode.Weekly;
        var monday = WeeklyBudgetCalculator.WeekStartFor(_store.Today, DayOfWeek.Monday);
        await Diary().LogQuickAsync(new LogQuickRequest(monday, MealSlot.Dinner, "Big dinner", 2600, null, null, null));
        await Diary().LogQuickAsync(new LogQuickRequest(monday.AddDays(1), MealSlot.Dinner, "Normal day", 2000, null, null, null));

        var week = await Plan().GetWeekAsync(_store.Today);
        // 600 over across Wed–Sun (5 days) → 1880.
        Assert.All(week.Days.Where(d => !d.IsPast), d => Assert.Equal(1880, d.AdjustedCalorieTarget));
    }

    [Fact]
    public async Task Batch_recipe_is_bought_once_on_the_grocery_list()
    {
        var chicken = _store.AddFood("Chicken breast, raw", 120, 22.5, 0, 2.6);
        var recipe = new Recipe("Chicken bowls", 4);
        recipe.SetIngredientLines(["800 g chicken breast"]);
        var ing = recipe.Ingredients[0];
        (ing.FoodId, ing.FoodName, ing.Grams, ing.Status) = (chicken.Id, chicken.Name, 800, IngredientMatchStatus.Confirmed);
        _store.Recipes.Add(recipe);

        await Plan().AddBatchAsync(new AddBatchRequest(recipe.Id, 1,
            [new(_store.Today, MealSlot.Lunch), new(_store.Today.AddDays(1), MealSlot.Lunch), new(_store.Today.AddDays(2), MealSlot.Lunch), new(_store.Today.AddDays(3), MealSlot.Lunch)]));

        var list = await new GroceryService(_store, _store, _store, _store).BuildAsync(_store.Today, _store.Today.AddDays(6));
        var item = list.Aisles.SelectMany(a => a.Items).Single();
        Assert.Equal(800, item.TotalGrams);
        Assert.Equal("Meat & Seafood", list.Aisles.Single().Aisle);
    }

    [Fact]
    public async Task What_can_i_make_ranks_recipes_by_missing_ingredients()
    {
        var easy = new Recipe("Scrambled eggs", 1);
        easy.SetIngredientLines(["3 large eggs", "1 tbsp butter", "salt to taste"]);
        var hard = new Recipe("Shakshuka", 2);
        hard.SetIngredientLines(["4 large eggs", "1 can tomatoes", "1 onion", "1 red pepper", "2 tsp cumin"]);
        _store.Recipes.AddRange([easy, hard]);
        _store.Pantry.AddRange([new("Eggs"), new("Butter"), new("Tomatoes")]);

        var result = await new PantryService(_store, _store, _store, _store).WhatCanIMakeAsync(maxMissing: 3);

        Assert.Equal("Scrambled eggs", result[0].Recipe.Name);
        Assert.Empty(result[0].Missing);
        Assert.Equal(3, result[1].Missing.Count);
    }

    [Fact]
    public void Gap_targets_use_remaining_amounts_and_skip_nutrients_without_targets()
    {
        var targets = new NutritionTargets { Calories = 2000, ProteinGrams = 120 };
        var have = new Domain.Nutrients.NutrientProfile(new Dictionary<int, double> { [1008] = 1500, [1003] = 80 });
        var gaps = GapFillService.BuildTargets(targets, have, includeMicros: false);
        Assert.Equal(500, gaps.Single(g => g.NutrientId == 1008).Remaining);
        Assert.Equal(40, gaps.Single(g => g.NutrientId == 1003).Remaining);
        Assert.Equal(4, gaps.Count);
    }

    [Theory]
    [InlineData("Poultry Products", "Chicken, breast", "Meat & Seafood")]
    [InlineData("Salad dressings and vegetable oils", "Olive oil", "Oils & Condiments")]
    [InlineData("Spices and Herbs", "Salt, table", "Baking & Spices")]
    [InlineData("Bananas", "Banana", "Produce")]
    [InlineData("Milk, reduced fat", "Milk", "Dairy & Eggs")]
    [InlineData(null, "Mystery item", "Other")]
    public void Aisles_are_inferred_from_category_or_name(string? category, string name, string aisle) =>
        Assert.Equal(aisle, Aisles.For(category, name));

    [Theory]
    [InlineData("I had 2 eggs and toast for breakfast", AssistantIntent.LogFood, 2)]
    [InlineData("half a pound of chicken breast", AssistantIntent.FindFood, 1)]
    [InlineData("show me christmas cookie recipes", AssistantIntent.FindRecipes, 0)]
    [InlineData("what can I make with what I have?", AssistantIntent.WhatCanIMake, 0)]
    [InlineData("what should I eat to hit my protein", AssistantIntent.FillGaps, 0)]
    public void Rule_based_interpreter_detects_intent(string text, AssistantIntent intent, int items)
    {
        var result = RuleBasedInterpreter.Interpret(text, new DateOnly(2026, 11, 18));
        Assert.Equal(intent, result.Intent);
        Assert.Equal(items, result.Items.Count);
    }

    [Fact]
    public void Rule_based_interpreter_reads_meal_and_relative_date()
    {
        var result = RuleBasedInterpreter.Interpret("yesterday for lunch I had a turkey sandwich", new DateOnly(2026, 11, 18));
        Assert.Equal(MealSlot.Lunch, result.Meal);
        Assert.Equal(new DateOnly(2026, 11, 17), result.Date);
        Assert.Contains(result.Items, i => i.FoodQuery.Contains("turkey sandwich"));
    }

    [Fact]
    public void Ranker_prefers_plain_raw_trusted_foods_over_derived_products()
    {
        var rows = new[]
        {
            Row("Almond butter, creamy", FoodSource.UsdaFoundation),
            Row("Nuts, almonds", FoodSource.UsdaSrLegacy),
            Row("Almond milk, unsweetened", FoodSource.UsdaFoundation),
            Row("Almonds, chocolate covered", FoodSource.OpenFoodFacts),
        };
        Assert.Equal("Nuts, almonds", FoodRanker.Rank("almonds", rows)[0].Food.Name);

        var chicken = new[]
        {
            Row("Chicken breast tenders, breaded, uncooked", FoodSource.UsdaSrLegacy),
            Row("Chicken, breast, boneless, skinless, raw", FoodSource.UsdaFoundation),
            Row("Chicken, broilers or fryers, breast, meat only, cooked, roasted", FoodSource.UsdaSrLegacy),
        };
        Assert.Equal("Chicken, breast, boneless, skinless, raw", FoodRanker.Rank("chicken breast", chicken)[0].Food.Name);
        Assert.Equal("Chicken, broilers or fryers, breast, meat only, cooked, roasted", FoodRanker.Rank("chicken breast cooked", chicken)[0].Food.Name);
    }

    [Fact]
    public void Ranker_boosts_foods_you_log_often()
    {
        var a = new FoodSearchRow(MakeFood("Yogurt, Greek, plain, nonfat", FoodSource.UsdaFoundation), 0.4, 0);
        var b = new FoodSearchRow(MakeFood("Yogurt, Greek, plain, lowfat", FoodSource.UsdaSrLegacy), 0.4, 25);
        Assert.Equal(b.Food.Name, FoodRanker.Rank("greek yogurt", [a, b])[0].Food.Name);
    }

    private static FoodSearchRow Row(string name, FoodSource source) => new(MakeFood(name, source), 0.3, 0);

    private static Food MakeFood(string name, FoodSource source) =>
        new(name, source, new Domain.Nutrients.NutrientProfile(new Dictionary<int, double> { [1008] = 100, [1003] = 5, [1005] = 10, [1004] = 4 }));
}
