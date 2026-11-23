using NutriPlan.Application.Abstractions;
using NutriPlan.Application.Common;
using NutriPlan.Application.Diary;
using NutriPlan.Application.Foods;
using NutriPlan.Application.Planning;
using NutriPlan.Application.Recipes;
using NutriPlan.Domain.Diary;
using NutriPlan.Domain.Recipes;

namespace NutriPlan.Application.Tests;

/// <summary>Unified recipes: a recipe can be an ingredient of another (any depth), with no loops, and edits flow upward.</summary>
public class NestedRecipeTests
{
    private sealed class NoWeb : IWebPageFetcher
    {
        public Task<string> GetHtmlAsync(Uri url, CancellationToken ct = default) => throw new NotSupportedException();
    }

    private readonly InMemoryStore _store = new();
    private DiaryService Diary() => new(_store, _store, _store, _store, _store, _store);
    private PlanService Plan() => new(_store, _store, _store, Diary(), _store, _store);
    private RecipeService Recipes() => new(_store, _store, new FoodService(_store, [], _store), new NoWeb(), _store);

    /// <summary>A recipe with one food line of <paramref name="grams"/> g of a 100 kcal/100 g food, making <paramref name="servings"/>.</summary>
    private async Task<Guid> SimpleAsync(string name, double grams, double servings, double kcalPer100 = 100)
    {
        var food = _store.AddFood($"{name} base", kcalPer100, 10, 10, 2);
        var detail = await Recipes().CreateAsync(new SaveRecipeRequest(name, servings, [$"{grams} g {name} base"], null, null, null, null, null));
        await Recipes().UpdateIngredientAsync(detail.Summary.Id, 0, new UpdateIngredientRequest(food.Id, grams, null, null, null));
        return detail.Summary.Id;
    }

    private async Task<Guid> WithLineAsync(string name, string line, double servings = 1)
    {
        var detail = await Recipes().CreateAsync(new SaveRecipeRequest(name, servings, [line], null, null, null, null, null));
        return detail.Summary.Id;
    }

    private Recipe R(Guid id) => _store.Recipes.Single(r => r.Id == id);

    [Fact]
    public async Task A_recipe_used_as_an_ingredient_counts_its_per_serving_nutrition()
    {
        var sauce = await SimpleAsync("Sauce", 400, 4);             // 400 kcal, 100 per serving
        var pasta = await WithLineAsync("Pasta bake", "2 servings sauce", 2);
        var d = await Recipes().UpdateIngredientAsync(pasta, 0, new UpdateIngredientRequest(null, null, null, null, null, sauce, 2));

        Assert.Equal(200, d.Total!.Calories, 1);                     // 2 servings × 100
        Assert.Equal(100, d.Summary.PerServing.Calories, 1);         // over 2 servings
        var line = d.Ingredients.Single();
        Assert.Equal(sauce, line.RecipeId);
        Assert.Null(line.FoodId);
        Assert.Equal("Sauce", line.RecipeName);
        Assert.Equal(1, d.Summary.Coverage);
    }

    [Fact]
    public async Task Nesting_works_at_several_levels_and_an_edit_at_the_bottom_reaches_the_top()
    {
        var stock = await SimpleAsync("Stock", 1000, 10);           // 100 kcal per serving
        var soup = await WithLineAsync("Soup", "4 servings stock", 2);
        await Recipes().UpdateIngredientAsync(soup, 0, new UpdateIngredientRequest(null, null, null, null, null, stock, 4)); // 400 → 200/serving
        var meal = await WithLineAsync("Soup and bread meal", "1 bowl soup");
        await Recipes().UpdateIngredientAsync(meal, 0, new UpdateIngredientRequest(null, null, null, null, null, soup, 1));
        Assert.Equal(200, R(meal).NutritionPerServing.Calories, 1);

        // The stock now makes 5 servings from the same pot: each is twice as rich, and that flows up two levels.
        await Recipes().SetServingsAsync(stock, 5);
        Assert.Equal(400, R(soup).NutritionPerServing.Calories, 1);
        Assert.Equal(400, R(meal).NutritionPerServing.Calories, 1);
    }

    [Fact]
    public async Task A_recipe_cannot_contain_itself_directly_or_through_others()
    {
        var a = await WithLineAsync("A", "1 serving b");
        var b = await WithLineAsync("B", "1 serving c");
        var c = await WithLineAsync("C", "1 serving a");
        await Recipes().UpdateIngredientAsync(a, 0, new UpdateIngredientRequest(null, null, null, null, null, b, 1));
        await Recipes().UpdateIngredientAsync(b, 0, new UpdateIngredientRequest(null, null, null, null, null, c, 1));

        var self = await Assert.ThrowsAsync<ValidationException>(() => Recipes().UpdateIngredientAsync(c, 0, new UpdateIngredientRequest(null, null, null, null, null, c, 1)));
        Assert.Contains("itself", self.Message);
        var loop = await Assert.ThrowsAsync<ValidationException>(() => Recipes().UpdateIngredientAsync(c, 0, new UpdateIngredientRequest(null, null, null, null, null, a, 1)));
        Assert.Contains("“A” already uses “C”", loop.Message);
        Assert.Null(R(c).Ingredients[0].RecipeId); // nothing was changed
    }

    [Fact]
    public async Task A_recipe_used_elsewhere_cannot_be_deleted_until_removed_there()
    {
        var sauce = await SimpleAsync("Sauce", 400, 4);
        var pasta = await WithLineAsync("Pasta bake", "1 serving sauce");
        await Recipes().UpdateIngredientAsync(pasta, 0, new UpdateIngredientRequest(null, null, null, null, null, sauce, 1));

        var e = await Assert.ThrowsAsync<ValidationException>(() => Recipes().DeleteAsync(sauce));
        Assert.Contains("Pasta bake", e.Message);
        Assert.Contains(_store.Recipes, r => r.Id == sauce);
        Assert.Equal("Pasta bake", Assert.Single((await Recipes().GetAsync(sauce)).UsedIn!).Name);

        await Recipes().UpdateIngredientAsync(pasta, 0, new UpdateIngredientRequest(null, null, null, null, true));
        await Recipes().DeleteAsync(sauce);
        Assert.DoesNotContain(_store.Recipes, r => r.Id == sauce);
    }

    [Fact]
    public async Task A_nested_amount_by_weight_uses_the_finished_weight_and_follows_it_when_it_changes()
    {
        var sauce = await SimpleAsync("Sauce", 400, 4);             // 400 kcal
        var s = await Recipes().GetAsync(sauce);
        await Recipes().UpdateAsync(sauce, new SaveRecipeRequest("Sauce", 4, ["400 g Sauce base"], null, null, null, null, 800)); // 800 g finished
        var pasta = await WithLineAsync("Pasta bake", "200 g sauce");

        // Without a finished weight a weight can't be converted, so it isn't guessed.
        var bare = await SimpleAsync("Dressing", 100, 2);
        var e = await Assert.ThrowsAsync<ValidationException>(() => Recipes().UpdateIngredientAsync(pasta, 0, new UpdateIngredientRequest(null, null, 50, "g", null, bare)));
        Assert.Contains("finished weight", e.Message);

        var d = await Recipes().UpdateIngredientAsync(pasta, 0, new UpdateIngredientRequest(null, null, 200, "g", null, sauce));
        Assert.Equal(100, d.Total!.Calories, 1);                     // 200 of 800 g → a quarter of 400 kcal
        Assert.Equal(1, d.Ingredients[0].Servings!.Value, 3);
        Assert.Equal(200, d.Ingredients[0].Grams!.Value, 1);

        // Reduced further, the same sauce weighs 400 g: 200 g is now half of it.
        await Recipes().UpdateAsync(sauce, new SaveRecipeRequest("Sauce", 4, ["400 g Sauce base"], null, null, null, null, 400));
        Assert.Equal(200, R(pasta).NutritionPerServing.Calories, 1);
        Assert.Equal(2, R(pasta).Ingredients[0].Servings!.Value, 3);
    }

    [Fact]
    public async Task Diary_and_plan_entries_keep_their_snapshot_when_a_nested_recipe_changes()
    {
        var sauce = await SimpleAsync("Sauce", 400, 4);
        var pasta = await WithLineAsync("Pasta bake", "2 servings sauce");
        await Recipes().UpdateIngredientAsync(pasta, 0, new UpdateIngredientRequest(null, null, null, null, null, sauce, 2));
        var logged = await Diary().LogRecipeAsync(new LogRecipeRequest(_store.Today, MealSlot.Dinner, pasta, 1));
        var planned = await Plan().AddRecipeAsync(new AddPlanRecipeRequest(_store.Today.AddDays(1), MealSlot.Dinner, pasta, 1));
        Assert.Equal(200, logged.Item.Nutrition.Calories, 1);

        await Recipes().SetServingsAsync(sauce, 2);                  // sauce servings twice as rich → pasta doubles
        Assert.Equal(400, R(pasta).NutritionPerServing.Calories, 1);
        Assert.Equal(200, _store.Diary.Single().Item.Nutrients.Calories, 1);
        Assert.Equal(200, _store.Plan.Single().Item.Nutrients.Calories, 1);
        // A new log uses the new numbers.
        Assert.Equal(400, (await Diary().LogRecipeAsync(new LogRecipeRequest(_store.Today, MealSlot.Lunch, pasta, 1))).Item.Nutrition.Calories, 1);
    }

    [Fact]
    public async Task Nested_recipes_with_missing_ingredients_lower_coverage_and_say_so()
    {
        var half = await Recipes().CreateAsync(new SaveRecipeRequest("Half known", 1, ["100 g mystery thing", "100 g other mystery"], null, null, null, null, null));
        var food = _store.AddFood("Known base", 100, 1, 1, 1);
        await Recipes().UpdateIngredientAsync(half.Summary.Id, 0, new UpdateIngredientRequest(food.Id, 100, null, null, null));
        var outer = await WithLineAsync("Outer", "1 serving half");
        var d = await Recipes().UpdateIngredientAsync(outer, 0, new UpdateIngredientRequest(null, null, null, null, null, half.Summary.Id, 1));
        Assert.Equal(0.5, d.Summary.Coverage, 2);
        Assert.Contains(d.Warnings, w => w.Contains("Half known") && w.Contains("minimum"));
    }

    [Fact]
    public async Task Switching_a_line_from_a_recipe_back_to_a_food_clears_the_recipe()
    {
        var sauce = await SimpleAsync("Sauce", 400, 4);
        var pasta = await WithLineAsync("Pasta bake", "100 g tomatoes");
        await Recipes().UpdateIngredientAsync(pasta, 0, new UpdateIngredientRequest(null, null, null, null, null, sauce, 1));
        var tomato = _store.AddFood("Tomatoes, raw", 18, 1, 4, 0.2);
        var d = await Recipes().UpdateIngredientAsync(pasta, 0, new UpdateIngredientRequest(tomato.Id, 100, null, null, null));
        var line = d.Ingredients.Single();
        Assert.Equal(tomato.Id, line.FoodId);
        Assert.Null(line.RecipeId);
        Assert.Null(line.Servings);
        Assert.Equal(18, d.Total!.Calories, 1);
        Assert.Equal("UsdaSrLegacy", line.FoodSource);              // ingredient provenance travels with the line
        Assert.Empty((await Recipes().GetAsync(sauce)).UsedIn!);
    }

    [Fact]
    public async Task A_recipe_is_logged_and_planned_in_its_measures_and_the_amount_can_change_measure()
    {
        var soup = await SimpleAsync("Soup", 1000, 4);              // 1000 kcal, 250/serving
        await Recipes().UpdateAsync(soup, new SaveRecipeRequest("Soup", 4, ["1000 g Soup base"], null, null, null, null, 2000, 1892.7)); // 8 cups

        var measures = (await Recipes().GetAsync(soup)).Measures!;
        Assert.Contains(measures, m => m.Unit == "serving" && m.Base == 1);
        Assert.Contains(measures, m => m.Unit == "g" && Math.Abs(m.Base - 1 / 500.0) < 1e-9);
        Assert.Contains(measures, m => m.Unit == "cup");

        var byCup = await Diary().LogRecipeAsync(new LogRecipeRequest(_store.Today, MealSlot.Lunch, soup, 0, null, 1, "cup")); // 1 of 8 cups
        Assert.Equal(125, byCup.Item.Nutrition.Calories, 0);
        Assert.Equal("cup", byCup.Item.Unit);
        var byWeight = await Plan().AddRecipeAsync(new AddPlanRecipeRequest(_store.Today, MealSlot.Dinner, soup, 0, 250, "g"));
        Assert.Equal(125, byWeight.Item.Nutrition.Calories, 0);

        // 1 cup → 2 servings: scaled from the entry's own snapshot by the change in servings.
        var changed = await Diary().UpdateAsync(byCup.Id, null, null, null, null, default, 2, "servings");
        Assert.Equal(500, changed.Item.Nutrition.Calories, 0);
        Assert.Equal("servings", changed.Item.Unit);
    }

    [Fact]
    public async Task A_recipe_without_a_finished_weight_cannot_be_logged_by_weight()
    {
        var bowl = await SimpleAsync("Bowl", 300, 1);
        var e = await Assert.ThrowsAsync<ValidationException>(() => Diary().LogRecipeAsync(new LogRecipeRequest(_store.Today, MealSlot.Lunch, bowl, 0, null, 100, "g")));
        Assert.Contains("finished weight", e.Message);
        Assert.Empty(_store.Diary);
    }
}
