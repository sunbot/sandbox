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

    [Fact]
    public async Task Unknown_nutrients_stay_unknown_through_nesting_and_known_ones_add_up()
    {
        // The sauce's tomatoes report vitamin C; the noodles don't; nothing reports vitamin D.
        var tomato = new Domain.Foods.Food("Tomatoes, raw", Domain.Foods.FoodSource.UsdaSrLegacy, new Domain.Nutrients.NutrientProfile(new Dictionary<int, double>
        {
            [Domain.Nutrients.NutrientIds.Energy] = 20, [Domain.Nutrients.NutrientIds.VitaminC] = 14,
        }));
        _store.Foods.Add(tomato);
        var sauce = (await Recipes().CreateAsync(new SaveRecipeRequest("Sauce", 2, ["200 g tomatoes"], null, null, null, null, null))).Summary.Id;
        await Recipes().UpdateIngredientAsync(sauce, 0, new UpdateIngredientRequest(tomato.Id, 200, null, null, null)); // 28 mg C, 14 per serving

        var noodles = await SimpleAsync("Noodles", 100, 1);
        var outer = (await Recipes().CreateAsync(new SaveRecipeRequest("Noodles with sauce", 1, ["1 serving noodles", "1 serving sauce"], null, null, null, null, null))).Summary.Id;
        await Recipes().UpdateIngredientAsync(outer, 0, new UpdateIngredientRequest(null, null, null, null, null, noodles, 1));
        var d = await Recipes().UpdateIngredientAsync(outer, 1, new UpdateIngredientRequest(null, null, null, null, null, sauce, 1));

        var n = R(outer).NutritionPerServing;
        Assert.Equal(14, n[Domain.Nutrients.NutrientIds.VitaminC]!.Value, 2);           // the known part only (a minimum)
        Assert.False(n.Has(Domain.Nutrients.NutrientIds.VitaminD));                     // nobody reports it: unknown, not 0
        Assert.Equal(100 + 20, d.Total!.Calories, 1);
    }

    [Fact]
    public async Task Existing_recipes_without_nested_lines_calculate_exactly_as_before()
    {
        var id = await SimpleAsync("Plain stew", 500, 2, kcalPer100: 80); // 400 kcal over 2
        var r = R(id);
        var foods = _store.Foods.ToDictionary(f => f.Id);
        var before = RecipeNutritionCalculator.Calculate(r, foods);               // the old call, no recipes passed
        var now = RecipeNutritionCalculator.Calculate(r, foods, new Dictionary<Guid, Recipe>());
        Assert.Equal(before.PerServing, now.PerServing);
        Assert.Equal(before.Coverage, now.Coverage);
        Assert.Equal(200, r.NutritionPerServing.Calories, 1);
        Assert.Equal(["serving"], (await Recipes().GetAsync(id)).Measures!.Select(m => m.Unit)); // no weight/volume until entered
        Assert.Empty(r.SubRecipeIds);
    }

    [Fact]
    public async Task An_ingredient_list_saved_before_nesting_existed_still_reads()
    {
        // JSON as stored by earlier versions: no recipeId/recipeName/servings keys.
        const string old = """[{"position":0,"rawText":"100 g rice","amount":100,"unit":"g","foodText":"rice","preparation":null,"foodId":"5b0a7c0e-8c7e-4a53-9f25-0d0b8f1f0c11","foodName":"Rice","grams":100,"status":"Confirmed","matchConfidence":1,"resolutionNote":null}]""";
        var options = new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web) { Converters = { new System.Text.Json.Serialization.JsonStringEnumConverter() } };
        var lines = System.Text.Json.JsonSerializer.Deserialize<List<RecipeIngredient>>(old, options)!;
        var line = Assert.Single(lines);
        Assert.Null(line.RecipeId);
        Assert.False(line.IsRecipe);
        Assert.True(line.CountsTowardNutrition);
    }
}
