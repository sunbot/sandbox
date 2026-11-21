using NutriPlan.Application.Abstractions;
using NutriPlan.Application.Diary;
using NutriPlan.Application.Foods;
using NutriPlan.Application.Planning;
using NutriPlan.Application.Recipes;
using NutriPlan.Domain.Diary;
using NutriPlan.Domain.Foods;
using NutriPlan.Domain.Planning;
using NutriPlan.Domain.Recipes;

namespace NutriPlan.Application.Tests;

/// <summary>Recipe Details: logging respects the chosen meal, and saved diary/plan nutrition never changes when a recipe does.</summary>
public class RecipeLoggingTests
{
    private sealed class NoWeb : IWebPageFetcher
    {
        public Task<string> GetHtmlAsync(Uri url, CancellationToken ct = default) => throw new NotSupportedException();
    }

    private readonly InMemoryStore _store = new();
    private DiaryService Diary() => new(_store, _store, _store, _store, _store, _store);
    private PlanService Plan() => new(_store, _store, _store, Diary(), _store, _store);
    private RecipeService Recipes() => new(_store, _store, new FoodService(_store, [], _store), new NoWeb(), _store);

    private async Task<Recipe> BowlAsync()
    {
        var rice = _store.AddFood("Rice, white, cooked", 130, 2.7, 28, 0.3);
        var recipe = new Recipe("Rice bowl", 2);
        recipe.SetIngredientLines(["400 g cooked white rice"]);
        var ing = recipe.Ingredients[0];
        (ing.FoodId, ing.FoodName, ing.Grams, ing.Status) = (rice.Id, rice.Name, 400, IngredientMatchStatus.Confirmed);
        _store.Recipes.Add(recipe);
        recipe.ApplyNutrition(RecipeNutritionCalculator.Calculate(recipe, new Dictionary<Guid, Food> { [rice.Id] = rice }));
        return recipe;
    }

    [Theory]
    [InlineData(MealSlot.Breakfast)]
    [InlineData(MealSlot.Lunch)]
    [InlineData(MealSlot.Dinner)]
    [InlineData(MealSlot.Snack)]
    public async Task Logging_a_recipe_uses_the_meal_that_was_asked_for(MealSlot meal)
    {
        var recipe = await BowlAsync();
        var logged = await Diary().LogRecipeAsync(new LogRecipeRequest(_store.Today, meal, recipe.Id, 1));
        Assert.Equal(meal.ToString(), logged.Meal);
        Assert.Equal(meal, _store.Diary.Single().Meal);
    }

    [Fact]
    public async Task Fractional_servings_scale_the_logged_nutrition()
    {
        var recipe = await BowlAsync();           // 400 g × 130 kcal/100 g = 520 kcal over 2 servings → 260 each
        var half = await Diary().LogRecipeAsync(new LogRecipeRequest(_store.Today, MealSlot.Lunch, recipe.Id, 0.5));
        Assert.Equal(130, half.Item.Nutrition.Calories, 1);
        var oneAndHalf = await Diary().LogRecipeAsync(new LogRecipeRequest(_store.Today, MealSlot.Lunch, recipe.Id, 1.5));
        Assert.Equal(390, oneAndHalf.Item.Nutrition.Calories, 1);
    }

    [Fact]
    public async Task A_logged_recipe_keeps_its_nutrition_when_the_recipe_is_edited_or_deleted()
    {
        var recipe = await BowlAsync();
        var logged = await Diary().LogRecipeAsync(new LogRecipeRequest(_store.Today, MealSlot.Dinner, recipe.Id, 1));
        var before = (await Diary().GetDayAsync(_store.Today)).Totals.Calories;

        // Change the ingredient's amount and the yield, then re-read the diary.
        recipe.Ingredients[0].Grams = 800;
        recipe.ApplyNutrition(RecipeNutritionCalculator.Calculate(recipe, _store.Foods.ToDictionary(f => f.Id)));
        recipe.SetServings(8);
        Assert.NotEqual(before, recipe.NutritionPerServing.Calories);
        Assert.Equal(before, (await Diary().GetDayAsync(_store.Today)).Totals.Calories);

        _store.Recipes.Remove(recipe);
        Assert.Equal(before, (await Diary().GetDayAsync(_store.Today)).Totals.Calories);
        Assert.Equal(logged.Item.Nutrition.Calories, _store.Diary.Single().Item.Nutrients.Calories, 6);
    }

    [Fact]
    public async Task A_planned_recipe_keeps_its_nutrition_when_the_recipe_changes()
    {
        var recipe = await BowlAsync();
        var planned = await Plan().AddRecipeAsync(new AddPlanRecipeRequest(_store.Today.AddDays(1), MealSlot.Dinner, recipe.Id, 1));
        recipe.Ingredients[0].Grams = 1200;
        recipe.ApplyNutrition(RecipeNutritionCalculator.Calculate(recipe, _store.Foods.ToDictionary(f => f.Id)));
        var week = await Plan().GetWeekAsync(_store.Today);
        Assert.Equal(planned.Item.Nutrition.Calories, week.Days.Single(d => d.Date == _store.Today.AddDays(1)).Planned.Single().Item.Nutrition.Calories, 6);
    }

    [Fact]
    public async Task Cooked_weight_is_saved_cleared_and_never_invented()
    {
        _store.AddFood("Oats", 379, 13, 68, 6.5, portions: new FoodPortion("cup", 80));
        var created = await Recipes().CreateAsync(new SaveRecipeRequest("Oat bowl", 2, ["1 cup oats"], null, null, null, null, null));
        Assert.Null(created.CookedWeightGrams);   // no weight is estimated from the ingredients

        var withWeight = await Recipes().UpdateAsync(created.Summary.Id, new SaveRecipeRequest("Oat bowl", 2, ["1 cup oats"], null, null, null, null, 450));
        Assert.Equal(450, withWeight.CookedWeightGrams);

        var cleared = await Recipes().UpdateAsync(created.Summary.Id, new SaveRecipeRequest("Oat bowl", 2, ["1 cup oats"], null, null, null, null, null));
        Assert.Null(cleared.CookedWeightGrams);
    }
}
