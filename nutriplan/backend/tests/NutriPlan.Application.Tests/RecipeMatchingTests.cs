using NutriPlan.Application.Abstractions;
using NutriPlan.Application.Foods;
using NutriPlan.Application.Recipes;
using NutriPlan.Domain.Foods;
using NutriPlan.Domain.Recipes;

namespace NutriPlan.Application.Tests;

/// <summary>
/// Phase 2.6 regressions from the food data audit (docs/FOOD_DATA_QUALITY_AUDIT.md): recipe ingredients are matched to the
/// food as bought, coconut milk variants are told apart, and a variant USDA doesn't have is never matched to another one.
/// </summary>
public class RecipeMatchingTests
{
    private sealed class NoWeb : IWebPageFetcher
    {
        public Task<string> GetHtmlAsync(Uri url, CancellationToken ct = default) => throw new NotSupportedException();
    }

    private readonly InMemoryStore _store = new();
    private RecipeService Recipes() => new(_store, _store, new FoodService(_store, [], _store), new NoWeb(), _store);

    private static FoodSearchRow Row(string name, FoodSource source) =>
        new(new Food(name, source, new Domain.Nutrients.NutrientProfile(new Dictionary<int, double> { [1008] = 100 })), 0.5, 0);

    // The real USDA entries behind the audit's two worst errors.
    private void SeedAuditFoods()
    {
        _store.AddFood("Coconut milk", 31, 0.2, 2.9, 2.1, FoodSource.UsdaSurvey, new FoodPortion("cup", 244));
        _store.AddFood("Nuts, coconut milk, canned (liquid expressed from grated meat and water)", 197, 2, 2.8, 21.3, FoodSource.UsdaSrLegacy, new FoodPortion("cup", 226));
        _store.AddFood("Beverages, coconut milk, sweetened, fortified with calcium, vitamins A, B12, D2", 31, 0.2, 2.9, 2.1, FoodSource.UsdaSrLegacy, new FoodPortion("cup", 240));
        _store.AddFood("Sweet potato, NFS", 115, 1.6, 17.1, 4.5, FoodSource.UsdaSurvey, new FoodPortion("medium", 150));
        _store.AddFood("Sweet potato, raw, unprepared (Includes foods for USDA's Food Distribution Program)", 86, 1.6, 20.1, 0.05, FoodSource.UsdaSrLegacy,
            new FoodPortion("sweetpotato, 5\" long", 130), new FoodPortion("cup, cubes", 133));
        _store.AddFood("Sweet potato, canned, mashed", 101, 2, 23.2, 0.2, FoodSource.UsdaSrLegacy, new FoodPortion("can (404 x 307)", 496));
    }

    private async Task<RecipeIngredient> MatchAsync(string line)
    {
        var detail = await Recipes().CreateAsync(new SaveRecipeRequest("Test", 1, [line], null, null, null, null, null));
        var recipe = _store.Recipes.Single(r => r.Id == detail.Summary.Id);
        return recipe.Ingredients.Single();
    }

    [Fact]
    public void For_a_recipe_ingredient_the_as_bought_entry_beats_FNDDS_NFS_but_logging_is_unchanged()
    {
        var nfs = Row("Sweet potato, NFS", FoodSource.UsdaSurvey);
        var raw = Row("Sweet potato, raw, unprepared (Includes foods for USDA's Food Distribution Program)", FoodSource.UsdaSrLegacy);
        Assert.Same(raw.Food, FoodRanker.Rank("sweet potato", [nfs, raw], useHistory: false, recipeIngredient: true)[0].Food);
        Assert.Same(nfs.Food, FoodRanker.Rank("sweet potato", [nfs, raw], useHistory: false)[0].Food); // logging a meal: "as eaten" is right
    }

    [Theory]
    [InlineData("coconut milk", "nuts coconut milk canned")]
    [InlineData("full-fat coconut milk", "nuts coconut milk canned")]
    [InlineData("canned coconut milk", "nuts coconut milk canned")]
    [InlineData("coconut milk beverage", "beverages coconut milk sweetened fortified")]
    [InlineData("unsweetened coconut milk beverage", "beverages coconut milk sweetened fortified")]
    [InlineData("refrigerated coconut milk", "beverages coconut milk sweetened fortified")]
    public void Coconut_milk_wording_chooses_the_canned_milk_or_the_drink(string text, string query) =>
        Assert.Equal(query, IngredientQuery.Clean(text));

    [Fact]
    public void Only_an_unsweetened_drink_is_a_stand_in_and_other_coconut_products_are_left_alone()
    {
        Assert.NotNull(IngredientQuery.StandIn("unsweetened coconut milk beverage"));
        Assert.Null(IngredientQuery.StandIn("coconut milk beverage"));
        Assert.Null(IngredientQuery.StandIn("coconut milk"));
        Assert.Null(IngredientQuery.Alias("coconut milk yogurt"));
        Assert.Null(IngredientQuery.Alias("coconut oil"));
        Assert.NotNull(IngredientQuery.NoUsdaEntry("light coconut milk"));
        Assert.NotNull(IngredientQuery.NoUsdaEntry("reduced-fat coconut milk"));
        Assert.Null(IngredientQuery.NoUsdaEntry("coconut milk"));
    }

    [Theory]
    [InlineData("black beans", "can", "1 can black beans, drained", "black beans canned")]
    [InlineData("diced tomatoes", "oz", "1 (14.5 oz) can diced tomatoes", "diced tomatoes canned")]
    [InlineData("tomatoes", null, "2 tomatoes, diced", "tomatoes")]
    [InlineData("nuts coconut milk canned", "can", "1 can coconut milk", "nuts coconut milk canned")]
    public void A_can_in_the_line_searches_for_the_canned_food(string query, string? unit, string raw, string expected) =>
        Assert.Equal(expected, IngredientQuery.WithPackagingContext(query, unit, raw));

    [Fact]
    public async Task A_can_of_coconut_milk_is_the_canned_milk_not_the_drink()
    {
        SeedAuditFoods();
        var ing = await MatchAsync("1 can (13.5 oz) coconut milk");
        Assert.StartsWith("Nuts, coconut milk, canned", ing.FoodName);
        Assert.Equal(382.7, ing.Grams!.Value, 1);
    }

    [Fact]
    public async Task Light_coconut_milk_is_left_unmatched_with_the_reason_instead_of_matching_full_fat()
    {
        SeedAuditFoods();
        var ing = await MatchAsync("1 can light coconut milk");
        Assert.Equal(IngredientMatchStatus.Unmatched, ing.Status);
        Assert.Null(ing.FoodId);
        Assert.Contains("no light coconut milk", ing.ResolutionNote);
    }

    [Fact]
    public async Task An_unsweetened_coconut_drink_is_matched_to_the_drink_and_flagged_as_a_stand_in()
    {
        SeedAuditFoods();
        var ing = await MatchAsync("1 cup unsweetened coconut milk beverage");
        Assert.StartsWith("Beverages, coconut milk", ing.FoodName);
        Assert.True(ing.MatchConfidence <= 0.4);
        Assert.Contains("Stand-in", ing.ResolutionNote);
    }

    [Fact]
    public async Task A_medium_sweet_potato_is_the_raw_vegetable_by_its_own_size_never_a_can()
    {
        SeedAuditFoods();
        var ing = await MatchAsync("2 medium sweet potatoes, peeled and cubed");
        Assert.StartsWith("Sweet potato, raw", ing.FoodName);
        Assert.Equal(260, ing.Grams!.Value, 1);
    }

    [Fact]
    public async Task Rematch_all_previews_without_saving_then_applies_once_and_keeps_your_confirmed_lines()
    {
        // A recipe matched before the canned entry was available: both lines on the drink.
        var drink = _store.AddFood("Coconut milk", 31, 0.2, 2.9, 2.1, FoodSource.UsdaSurvey, new FoodPortion("cup", 244));
        var detail = await Recipes().CreateAsync(new SaveRecipeRequest("Curry", 4, ["1 can (13.5 oz) coconut milk", "1 cup coconut milk"], null, null, null, null, null));
        await Recipes().UpdateIngredientAsync(detail.Summary.Id, 0, new UpdateIngredientRequest(drink.Id, 382.7, null, null, null));
        await Recipes().UpdateIngredientAsync(detail.Summary.Id, 1, new UpdateIngredientRequest(drink.Id, 244, null, null, null));
        var recipe = _store.Recipes.Single();
        // The old matcher's result for line 0, as stored before this phase: auto-matched, not chosen by you.
        recipe.Ingredients[0].Status = IngredientMatchStatus.AutoMatched;
        _store.AddFood("Nuts, coconut milk, canned (liquid expressed from grated meat and water)", 197, 2, 2.8, 21.3, FoodSource.UsdaSrLegacy, new FoodPortion("cup", 226));
        var savesBefore = _store.Saves;

        var preview = await Recipes().RematchAllAsync(apply: false);
        Assert.False(preview.Applied);
        var change = Assert.Single(preview.Changed);
        Assert.True(change.KcalPerServingAfter > change.KcalPerServingBefore, $"{change.KcalPerServingBefore} -> {change.KcalPerServingAfter}; {string.Join(" / ", change.Lines.Select(l => $"{l.RawText}: {l.FoodBefore} {l.GramsBefore} -> {l.FoodAfter} {l.GramsAfter} {l.Status}"))}");
        var line = Assert.Single(change.Lines);                      // the confirmed line isn't touched
        Assert.Equal("Coconut milk", line.FoodBefore);
        Assert.StartsWith("Nuts, coconut milk, canned", line.FoodAfter);
        Assert.Equal(savesBefore, _store.Saves);                     // a preview saves nothing

        var applied = await Recipes().RematchAllAsync(apply: true);
        Assert.True(applied.Applied);
        Assert.Equal(savesBefore + 1, _store.Saves);                 // one save for everything
        var after = _store.Recipes.Single();
        Assert.Equal(IngredientMatchStatus.Confirmed, after.Ingredients[1].Status);
        Assert.Equal("Coconut milk", after.Ingredients[1].FoodName);

        Assert.Empty((await Recipes().RematchAllAsync(apply: false)).Changed); // nothing left to change
    }
}
