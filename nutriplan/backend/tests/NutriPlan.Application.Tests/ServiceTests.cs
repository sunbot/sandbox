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

    private DiaryService Diary() => new(_store, _store, _store, _store, _store, _store);
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
    public async Task Bulk_move_keeps_mixed_meal_entries_and_their_snapshots_intact()
    {
        var foodId = Guid.NewGuid();
        var recipeId = Guid.NewGuid();
        var linkedPlanId = Guid.NewGuid();
        var foodSnapshot = ItemSnapshot.ForFood(foodId, "Food from snapshot", 40,
            new Domain.Nutrients.NutrientProfile(new Dictionary<int, double> { [1008] = 123, [1162] = 1.234 }));
        var recipeSnapshot = ItemSnapshot.ForRecipe(recipeId, "Recipe from snapshot", 2,
            new Domain.Nutrients.NutrientProfile(new Dictionary<int, double> { [1008] = 456, [1003] = 22 }));
        var breakfast = new DiaryEntry(_store.Today, MealSlot.Breakfast, foodSnapshot, linkedPlanId) { Note = "keep this" };
        var lunch = new DiaryEntry(_store.Today, MealSlot.Lunch, recipeSnapshot);
        ((IDiaryRepository)_store).Add(breakfast);
        ((IDiaryRepository)_store).Add(lunch);

        var moved = await Diary().MoveManyAsync(new(_store.Today, [lunch.Id, breakfast.Id], MealSlot.Dinner));

        Assert.Equal(1, _store.Saves);
        Assert.Equal(new[] { lunch.Id, breakfast.Id }, moved.Select(e => e.Id));
        Assert.All(new[] { breakfast, lunch }, e =>
        {
            Assert.Equal(_store.Today, e.Date);
            Assert.Equal(MealSlot.Dinner, e.Meal);
        });
        Assert.Same(foodSnapshot, breakfast.Item);
        Assert.Same(recipeSnapshot, lunch.Item);
        Assert.Equal(foodId, breakfast.Item.FoodId);
        Assert.Equal(recipeId, lunch.Item.RecipeId);
        Assert.Equal(linkedPlanId, breakfast.PlanEntryId);
        Assert.Equal("keep this", breakfast.Note);
        Assert.Equal(40, breakfast.Item.Grams);
        Assert.Equal(40, breakfast.Item.Quantity);
        Assert.Equal("g", breakfast.Item.QuantityUnit);
        Assert.Equal(2, lunch.Item.Quantity);
        Assert.Equal("servings", lunch.Item.QuantityUnit);
        Assert.Equal(foodSnapshot.Nutrients.Amounts, breakfast.Item.Nutrients.Amounts);
        Assert.Equal(recipeSnapshot.Nutrients.Amounts, lunch.Item.Nutrients.Amounts);
    }

    [Fact]
    public async Task Bulk_move_rejects_empty_duplicate_or_missing_entries_without_writing()
    {
        var entry = new DiaryEntry(_store.Today, MealSlot.Breakfast, ItemSnapshot.QuickCalories("Snack", 100));
        ((IDiaryRepository)_store).Add(entry);

        await Assert.ThrowsAsync<Common.ValidationException>(() =>
            Diary().MoveManyAsync(new(_store.Today, [], MealSlot.Dinner)));
        await Assert.ThrowsAsync<Common.ValidationException>(() =>
            Diary().MoveManyAsync(new(_store.Today, [entry.Id, entry.Id], MealSlot.Dinner)));
        await Assert.ThrowsAsync<Common.ValidationException>(() =>
            Diary().MoveManyAsync(new(_store.Today, [entry.Id], (MealSlot)99)));
        await Assert.ThrowsAsync<Common.NotFoundException>(() =>
            Diary().MoveManyAsync(new(_store.Today, [entry.Id, Guid.NewGuid()], MealSlot.Dinner)));

        Assert.Equal(0, _store.Saves);
        Assert.Equal(MealSlot.Breakfast, entry.Meal);
    }

    [Fact]
    public async Task Bulk_move_rejects_more_than_100_entries_before_writing()
    {
        var entry = new DiaryEntry(_store.Today, MealSlot.Breakfast, ItemSnapshot.QuickCalories("Snack", 100));
        ((IDiaryRepository)_store).Add(entry);
        var ids = Enumerable.Range(0, 101).Select(_ => Guid.NewGuid()).ToArray();

        await Assert.ThrowsAsync<Common.ValidationException>(() =>
            Diary().MoveManyAsync(new(_store.Today, ids, MealSlot.Dinner)));

        Assert.Equal(0, _store.Saves);
        Assert.Equal(MealSlot.Breakfast, entry.Meal);
    }

    [Fact]
    public async Task Bulk_move_rejects_mixed_dates_without_moving_any_entry()
    {
        var current = new DiaryEntry(_store.Today, MealSlot.Breakfast, ItemSnapshot.QuickCalories("Today", 100));
        var previous = new DiaryEntry(_store.Today.AddDays(-1), MealSlot.Lunch, ItemSnapshot.QuickCalories("Yesterday", 200));
        ((IDiaryRepository)_store).Add(current);
        ((IDiaryRepository)_store).Add(previous);

        await Assert.ThrowsAsync<Common.NotFoundException>(() =>
            Diary().MoveManyAsync(new(_store.Today, [current.Id, previous.Id], MealSlot.Dinner)));

        Assert.Equal(0, _store.Saves);
        Assert.Equal(_store.Today, current.Date);
        Assert.Equal(MealSlot.Breakfast, current.Meal);
        Assert.Equal(_store.Today.AddDays(-1), previous.Date);
        Assert.Equal(MealSlot.Lunch, previous.Meal);
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

        var list = await new GroceryService(_store, _store, _store, _store, _store).BuildAsync(_store.Today, _store.Today.AddDays(6));
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

    [Fact]
    public void Ranker_prefers_the_food_itself_over_a_food_that_only_contains_it()
    {
        var milk = new[] { Row("Yogurt, whole milk, plain", FoodSource.UsdaSrLegacy), Row("Milk, whole", FoodSource.UsdaSurvey) };
        Assert.Equal("Milk, whole", FoodRanker.Rank("whole milk", milk)[0].Food.Name);

        var oil = new[] { Row("Mayonnaise, reduced fat, with olive oil", FoodSource.UsdaSrLegacy), Row("Oil, olive, salad or cooking", FoodSource.UsdaSrLegacy) };
        Assert.Equal("Oil, olive, salad or cooking", FoodRanker.Rank("olive oil", oil)[0].Food.Name);
    }

    [Fact]
    public void Ranker_prefers_the_plain_food_over_a_combination_dish_unless_asked()
    {
        var rice = new[] { Row("Beans and brown rice", FoodSource.UsdaSurvey), Row("Rice, brown, cooked, NS as to fat", FoodSource.UsdaSurvey) };
        Assert.Equal("Rice, brown, cooked, NS as to fat", FoodRanker.Rank("brown rice", rice)[0].Food.Name);
        Assert.Equal("Beans and brown rice", FoodRanker.Rank("beans and brown rice", rice)[0].Food.Name);
    }

    [Fact]
    public void Ranker_prefers_the_food_over_dishes_that_mention_it()
    {
        var pizza = new[] { Row("Topping from cheese pizza", FoodSource.UsdaSurvey), Row("Dessert pizza", FoodSource.UsdaSurvey), Row("Pizza, cheese, from restaurant or fast food, medium crust", FoodSource.UsdaSurvey) };
        Assert.StartsWith("Pizza, cheese", FoodRanker.Rank("pizza", pizza)[0].Food.Name);
    }

    [Fact]
    public void A_missing_food_form_is_a_weak_match()
    {
        var rows = new[] { Row("Kale, raw", FoodSource.UsdaSrLegacy), Row("Snacks, potato chips, plain, salted", FoodSource.UsdaSrLegacy) };
        var best = FoodRanker.Rank("kale chips", rows).Single(r => r.Food.Name == "Kale, raw");
        Assert.True(FoodService.MatchConfidence(best.Score) < 0.5);
        var plain = FoodRanker.Rank("kale", rows).Single(r => r.Food.Name == "Kale, raw");
        Assert.True(plain.Score - best.Score >= 15);
    }

    [Fact]
    public void Recipe_matching_ignores_logging_history()
    {
        var yogurt = new FoodSearchRow(MakeFood("Yogurt, whole milk, plain", FoodSource.UsdaSrLegacy), 0.4, 60);
        var milk = new FoodSearchRow(MakeFood("Milk, whole", FoodSource.UsdaSurvey), 0.4, 0);
        Assert.Equal("Milk, whole", FoodRanker.Rank("whole milk", [yogurt, milk], useHistory: false)[0].Food.Name);
    }

    // Saturday 21 Nov 2026
    private static readonly DateOnly Sat = new(2026, 11, 21);

    [Fact]
    public void Planning_requests_are_plans_not_diary_entries()
    {
        var r = Assistant.RuleBasedInterpreter.Interpret("plan pizza for friday dinner", Sat);
        Assert.Equal(Abstractions.AssistantIntent.PlanMeal, r.Intent);
        Assert.Equal(new DateOnly(2026, 11, 27), r.Date); // the coming Friday
        Assert.Equal(Domain.Diary.MealSlot.Dinner, r.Meal);
        Assert.Equal("pizza", Assert.Single(r.Items).FoodQuery);
    }

    [Theory]
    [InlineData("2 eggs for breakfast tomorrow")]
    [InlineData("turkey chili for dinner on monday")]
    [InlineData("add salmon to my plan for next saturday")]
    public void Food_for_a_future_day_is_planned(string text) =>
        Assert.Equal(Abstractions.AssistantIntent.PlanMeal, Assistant.RuleBasedInterpreter.Interpret(text, Sat).Intent);

    [Fact]
    public void Past_weekdays_are_still_logged()
    {
        var r = Assistant.RuleBasedInterpreter.Interpret("I had pizza on friday", Sat);
        Assert.Equal(Abstractions.AssistantIntent.LogFood, r.Intent);
        Assert.Equal(new DateOnly(2026, 11, 20), r.Date);
    }

    [Fact]
    public void Food_words_are_not_weekdays()
    {
        var r = Assistant.RuleBasedInterpreter.Interpret("sun-dried tomatoes and saturated fat free yogurt", Sat);
        Assert.Null(r.Date);
        Assert.NotEqual(Abstractions.AssistantIntent.PlanMeal, r.Intent);
    }

    [Fact]
    public void Language_model_logging_for_a_future_day_becomes_a_plan()
    {
        Assert.Equal(Abstractions.AssistantIntent.PlanMeal, Assistant.AssistantService.ResolveIntent(Abstractions.AssistantIntent.LogFood, Sat.AddDays(3), Sat));
        Assert.Equal(Abstractions.AssistantIntent.LogFood, Assistant.AssistantService.ResolveIntent(Abstractions.AssistantIntent.LogFood, Sat, Sat));
        Assert.Equal(Abstractions.AssistantIntent.FindRecipes, Assistant.AssistantService.ResolveIntent(Abstractions.AssistantIntent.FindRecipes, Sat.AddDays(3), Sat));
    }

    private static FoodSearchRow Row(string name, FoodSource source) => new(MakeFood(name, source), 0.3, 0);

    private static Food MakeFood(string name, FoodSource source) =>
        new(name, source, new Domain.Nutrients.NutrientProfile(new Dictionary<int, double> { [1008] = 100, [1003] = 5, [1005] = 10, [1004] = 4 }));
}
