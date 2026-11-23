using NutriPlan.Application.Abstractions;
using NutriPlan.Application.Common;
using NutriPlan.Application.Foods;
using NutriPlan.Application.Recipes;
using NutriPlan.Domain.Foods;
using NutriPlan.Domain.Recipes;

namespace NutriPlan.Application.Tests;

/// <summary>Phase 2 recipe editor: adding lines from search, removing them, editing amounts and scaling.</summary>
public class RecipeEditorTests
{
    private sealed class NoWeb : IWebPageFetcher
    {
        public Task<string> GetHtmlAsync(Uri url, CancellationToken ct = default) => throw new NotSupportedException();
    }

    private readonly InMemoryStore _store = new();
    private RecipeService Recipes() => new(_store, _store, new FoodService(_store, [], _store), new NoWeb(), _store);
    private Recipe R(Guid id) => _store.Recipes.Single(r => r.Id == id);

    private async Task<Guid> EmptyAsync(string name, double servings = 2) =>
        (await Recipes().CreateAsync(new SaveRecipeRequest(name, servings, [], null, null, null, null, null))).Summary.Id;

    [Fact]
    public async Task A_food_added_from_search_becomes_a_confirmed_line_in_the_measure_chosen()
    {
        var oats = _store.AddFood("Oats", 380, 13, 68, 7, FoodSource.UsdaSrLegacy, new FoodPortion("cup", 81));
        var id = await EmptyAsync("Porridge");
        var d = await Recipes().AddIngredientAsync(id, new AddIngredientRequest(oats.Id, null, 1.5, "cup"));
        var line = Assert.Single(d.Ingredients);
        Assert.Equal("1.5 cup Oats", line.RawText);
        Assert.Equal("Confirmed", line.Status);
        Assert.Equal(121.5, line.Grams!.Value, 1);
        Assert.Equal(oats.Id, line.FoodId);
        Assert.Equal(380 * 1.215, d.Total!.Calories, 0);
        Assert.Equal(1, d.Summary.Coverage);
    }

    [Fact]
    public async Task A_recipe_added_from_search_is_nested_and_a_loop_is_refused_without_adding_anything()
    {
        var sauce = await EmptyAsync("Sauce", 4);
        var tomato = _store.AddFood("Tomatoes", 20, 1, 4, 0);
        await Recipes().AddIngredientAsync(sauce, new AddIngredientRequest(tomato.Id, null, null, null, 400));
        var pasta = await EmptyAsync("Pasta");
        var d = await Recipes().AddIngredientAsync(pasta, new AddIngredientRequest(null, sauce, null, null, Servings: 2));
        Assert.Equal("2 servings Sauce", d.Ingredients.Single().RawText);
        Assert.Equal(40, d.Total!.Calories, 1);   // 2 of 4 servings of an 80 kcal sauce

        await Assert.ThrowsAsync<ValidationException>(() => Recipes().AddIngredientAsync(sauce, new AddIngredientRequest(null, pasta, null, null, Servings: 1)));
        Assert.Single(R(sauce).Ingredients);
        await Assert.ThrowsAsync<ValidationException>(() => Recipes().AddIngredientAsync(pasta, new AddIngredientRequest(tomato.Id, sauce, 1, "g")));
        await Assert.ThrowsAsync<ValidationException>(() => Recipes().AddIngredientAsync(pasta, new AddIngredientRequest(null, null, 1, "g")));
    }

    [Fact]
    public async Task A_measure_the_food_does_not_have_is_left_for_you_to_check_not_guessed()
    {
        var spinach = _store.AddFood("Spinach, raw", 23, 3, 4, 0.4);   // no cup weight
        var id = await EmptyAsync("Salad");
        var line = (await Recipes().AddIngredientAsync(id, new AddIngredientRequest(spinach.Id, null, 2, "cup"))).Ingredients.Single();
        Assert.Null(line.Grams);
        Assert.Equal("AutoMatched", line.Status);                       // shown as "check": no grams were invented
        Assert.Null(line.Nutrition);
    }

    [Fact]
    public async Task Removing_a_line_renumbers_the_rest_recalculates_and_updates_recipes_that_use_it()
    {
        var a = _store.AddFood("A food", 100, 1, 1, 1);
        var b = _store.AddFood("B food", 200, 1, 1, 1);
        var sauce = await EmptyAsync("Sauce", 1);
        await Recipes().AddIngredientAsync(sauce, new AddIngredientRequest(a.Id, null, null, null, 100));
        await Recipes().AddIngredientAsync(sauce, new AddIngredientRequest(b.Id, null, null, null, 100));
        var outer = await EmptyAsync("Outer", 1);
        await Recipes().AddIngredientAsync(outer, new AddIngredientRequest(null, sauce, null, null, Servings: 1));
        Assert.Equal(300, R(outer).NutritionPerServing.Calories, 1);

        var d = await Recipes().RemoveIngredientAsync(sauce, 0);
        Assert.Equal([0], d.Ingredients.Select(i => i.Position));
        Assert.Equal(b.Id, d.Ingredients[0].FoodId);
        Assert.Equal(200, R(outer).NutritionPerServing.Calories, 1);
        await Assert.ThrowsAsync<KeyNotFoundException>(() => Recipes().RemoveIngredientAsync(sauce, 5));
    }

    [Fact]
    public async Task Scaling_doubles_every_amount_the_yield_and_finished_weight_but_not_the_per_serving_numbers()
    {
        var flour = _store.AddFood("Flour", 364, 10, 76, 1, FoodSource.UsdaSrLegacy, new FoodPortion("cup", 125));
        var stock = await EmptyAsync("Stock", 4);
        var water = _store.AddFood("Broth", 10, 1, 1, 0);
        await Recipes().AddIngredientAsync(stock, new AddIngredientRequest(water.Id, null, null, null, 1000));
        var id = (await Recipes().CreateAsync(new SaveRecipeRequest("Bread", 4, ["1 1/2 cups flour", "salt to taste"], null, null, null, null, 600, 800))).Summary.Id;
        await Recipes().UpdateIngredientAsync(id, 0, new UpdateIngredientRequest(flour.Id, null, 1.5, "cup", null));
        await Recipes().AddIngredientAsync(id, new AddIngredientRequest(null, stock, null, null, Servings: 1));
        var before = R(id).NutritionPerServing.Calories;

        var d = await Recipes().ScaleAsync(id, 2);
        Assert.Equal("3 cups flour", d.Ingredients[0].RawText);
        Assert.Equal(375, d.Ingredients[0].Grams!.Value, 1);
        Assert.Equal("salt to taste", d.Ingredients[1].RawText);       // no amount: unchanged
        Assert.Equal(2, d.Ingredients[2].Servings!.Value, 3);           // nested recipe: twice the servings
        Assert.Equal(8, d.Summary.Servings);
        Assert.Equal(1200, d.CookedWeightGrams);
        Assert.Equal(1600, d.FinishedVolumeMl);
        Assert.Equal(before, d.Summary.PerServing.Calories, 1);

        await Recipes().ScaleAsync(id, 0.5);
        Assert.Equal("1½ cups flour", R(id).Ingredients[0].RawText);
        Assert.Equal(4, R(id).Servings);
        await Assert.ThrowsAsync<ValidationException>(() => Recipes().ScaleAsync(id, 0));
        await Assert.ThrowsAsync<ValidationException>(() => Recipes().ScaleAsync(id, 200));
    }

    [Theory]
    [InlineData("1 1/2 cups flour", 2, "3 cups flour")]
    [InlineData("3/4 cup sugar", 2, "1½ cup sugar")]
    [InlineData("½ tsp salt", 2, "1 tsp salt")]
    [InlineData("1½ lb beef", 0.5, "¾ lb beef")]
    [InlineData("2.5 oz cheese", 2, "5 oz cheese")]
    [InlineData("1 can (15 oz) black beans", 2, "2 can (15 oz) black beans")]
    [InlineData("1 cup (220 g) brown sugar", 2, "2 cup (220 g) brown sugar")]    // the text's own number, not the parsed 220 g
    [InlineData("2 (14.5 oz) cans tomatoes", 2, "4 (14.5 oz) cans tomatoes")]
    [InlineData("2-3 cloves garlic", 2, "4-6 cloves garlic")]
    [InlineData("2 to 3 cloves garlic", 0.5, "1 to 1½ cloves garlic")]
    [InlineData("- 2 eggs", 2, "- 4 eggs")]
    [InlineData("1 cup rice", 0.4, "0.4 cup rice")]
    [InlineData("1. 1/4 cup sugar", 2, "1. 1/4 cup sugar")]                    // a list marker isn't an amount
    [InlineData("Salt to taste", 2, "Salt to taste")]
    [InlineData("4 chicken breasts (about 1½ pounds)", 2, "8 chicken breasts (about 1½ pounds)")]
    public void Scaling_multiplies_the_number_the_line_starts_with_and_keeps_the_rest(string line, double factor, string expected) =>
        Assert.Equal(expected, RecipeScaling.ScaleLeadingAmount(line, factor).Text);

    [Fact]
    public async Task A_scaled_line_whose_text_cannot_follow_keeps_its_scaled_amount_through_refresh()
    {
        var oil = _store.AddFood("Oil, olive", 884, 0, 0, 100, FoodSource.UsdaSrLegacy, new FoodPortion("tbsp", 13.5));
        var id = (await Recipes().CreateAsync(new SaveRecipeRequest("Sear", 4, ["Olive oil (about 2 tbsp for searing)"], null, null, null, null, null))).Summary.Id;
        var line = R(id).Ingredients[0];
        (line.FoodId, line.FoodName, line.Amount, line.Unit, line.Grams, line.Status, line.MatchConfidence) = (oil.Id, oil.Name, 2, "tbsp", 27, IngredientMatchStatus.AutoMatched, 0.9);
        var perServing = (await Recipes().ScaleAsync(id, 2)).Summary.PerServing.Calories;

        var after = await Recipes().RematchAsync(id);
        Assert.Equal(54, after.Ingredients[0].Grams!.Value, 1);          // still scaled
        Assert.Equal(perServing, after.Summary.PerServing.Calories, 1);
        Assert.Contains("Scaled ×2", after.Ingredients[0].Note);
    }

    [Theory]
    [InlineData(-500)]
    [InlineData(0)]
    [InlineData(60_000)]
    [InlineData(double.NaN)]
    public async Task Impossible_weights_are_refused(double grams)
    {
        var oats = _store.AddFood("Oats", 380, 13, 68, 7);
        var id = await EmptyAsync("Porridge");
        await Assert.ThrowsAsync<ValidationException>(() => Recipes().AddIngredientAsync(id, new AddIngredientRequest(oats.Id, null, null, null, grams)));
        Assert.Empty(R(id).Ingredients);
    }
}
