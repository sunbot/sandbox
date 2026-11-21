using NutriPlan.Application.Abstractions;
using NutriPlan.Application.Common;
using NutriPlan.Application.Diary;
using NutriPlan.Application.Foods;
using NutriPlan.Domain.Diary;
using NutriPlan.Domain.Foods;
using NutriPlan.Domain.Nutrients;
using NutriPlan.Domain.Units;

namespace NutriPlan.Application.Tests;

/// <summary>Branded search: ranking, caching, saving once, calculated calories, refresh rules and liquids.</summary>
public class BrandedFoodTests
{
    private readonly InMemoryStore _store = new();

    private sealed class FakeProvider : IBrandedFoodProvider
    {
        public List<BrandedProduct> Products { get; set; } = [];
        public ProviderFailure? Failure { get; set; }
        public int Searches { get; private set; }
        public int Gets { get; private set; }
        public TimeSpan Delay { get; set; }
        public string Name => "fake";
        public bool IsConfigured { get; set; } = true;
        public async Task<BrandedSearch> SearchAsync(string query, int limit, CancellationToken ct = default)
        {
            Searches++;
            if (Delay > TimeSpan.Zero) await Task.Delay(Delay, ct);
            return Failure is { } f ? new([], f) : new(Products);
        }
        public Task<BrandedFetch> GetAsync(string sourceId, CancellationToken ct = default)
        {
            Gets++;
            return Task.FromResult(Failure is { } f ? new BrandedFetch(null, f) : new BrandedFetch(Products.FirstOrDefault(p => p.SourceId == sourceId)));
        }
        public Task<BrandedFetch> FindByBarcodeAsync(string code, CancellationToken ct = default) => Task.FromResult(new BrandedFetch(Products.FirstOrDefault(p => p.Barcode == code)));
    }

    private static BrandedProduct P(string id, string name, string? brand, double? kcal = 100, string? barcode = null, NutrientBasis basis = NutrientBasis.Mass, double serving = 0, string servingWord = "serving")
    {
        var n = new Dictionary<int, double> { [NutrientIds.Protein] = 10, [NutrientIds.Carbohydrate] = 5, [NutrientIds.Fat] = 2 };
        if (kcal is not null) n[NutrientIds.Energy] = kcal.Value;
        return new(FoodSource.UsdaBranded, id, name, brand, barcode, new NutrientProfile(n), basis, serving > 0 ? [new FoodPortion(servingWord, serving)] : [], null);
    }

    private readonly FakeProvider _provider = new();
    private readonly RemoteSearchCache _cache = new();
    private BrandedFoodService Service() => new(_store, _provider, _cache, _store);

    [Fact]
    public void Brand_and_product_matches_rank_first_and_unrelated_products_drop_out()
    {
        var ranked = BrandedFoodService.Rank("Chobani greek yogurt", [
            P("1", "Greek Yogurt, Plain", "Fage"),
            P("2", "Oatmilk Vanilla", "Chobani"),
            P("3", "Plain Non-Fat Greek Yogurt", "Chobani"),
            P("4", "Tortilla Chips", "Tostitos"),
        ]).Select(p => p.SourceId).ToList();
        Assert.Equal("3", ranked[0]);                     // brand + every word
        Assert.Equal(["3", "1", "2"], ranked);            // Fage (product words) ahead of a Chobani milk (brand only)
        Assert.DoesNotContain("4", ranked);
    }

    [Fact]
    public void Duplicates_by_barcode_or_by_brand_and_name_collapse()
    {
        var ranked = BrandedFoodService.Rank("cooked white rice", [
            P("1", "Organic Cooked White Rice", "Heinen's", barcode: "0020601412125"),
            P("2", "Organic Cooked White Rice", "Heinen's", barcode: "0206014142125"),     // same product, different code
            P("3", "Cooked White Rice", "Minsley", barcode: "0858354001255"),
            P("4", "Cooked White Rice (dup code)", "Other", barcode: "0858354001255"),
        ]).Select(p => p.SourceId).ToList();
        Assert.Equal(2, ranked.Count);                        // one Heinen's, one Minsley
        Assert.Contains("3", ranked);
        Assert.Single(ranked, x => x is "1" or "2");
    }

    [Fact]
    public async Task A_repeated_search_uses_the_cache_and_concurrent_searches_share_one_call()
    {
        _provider.Products = [P("1", "White Bread", "Dave's Killer Bread")];
        _provider.Delay = TimeSpan.FromMilliseconds(50);
        await Task.WhenAll(Service().SearchAsync("daves killer bread"), Service().SearchAsync("Daves  killer bread"));
        await Service().SearchAsync("daves killer bread");
        Assert.Equal(1, _provider.Searches);
    }

    [Fact]
    public async Task A_failed_search_is_reported_never_cached_and_never_throws()
    {
        _provider.Failure = ProviderFailure.RateLimited;
        var r = await Service().SearchAsync("chobani");
        Assert.Equal("RateLimited", r.Failure);
        Assert.Empty(r.Results);
        _provider.Failure = null;
        _provider.Products = [P("1", "Greek Yogurt", "Chobani")];
        Assert.Single((await Service().SearchAsync("chobani")).Results);
        Assert.Equal(2, _provider.Searches);
    }

    [Fact]
    public async Task Without_a_key_branded_search_says_so_and_does_nothing()
    {
        _provider.IsConfigured = false;
        var r = await Service().SearchAsync("chobani");
        Assert.Equal("NotConfigured", r.Failure);
        Assert.Equal(0, _provider.Searches);
    }

    [Theory]
    [InlineData("a")]
    [InlineData("  ")]
    public async Task Too_short_a_query_returns_nothing(string q) => Assert.Empty((await Service().SearchAsync(q)).Results);

    [Fact]
    public async Task Overlong_queries_are_rejected() =>
        await Assert.ThrowsAsync<ValidationException>(() => Service().SearchAsync(new string('a', 101)));

    [Fact]
    public async Task Results_show_per_serving_numbers_only_from_a_labelled_size()
    {
        _provider.Products = [P("1", "White Bread", "Dave's Killer Bread", kcal: 275, serving: 40, servingWord: "slice"), P("2", "Bread Crumbs", "Dave's Killer Bread")];
        var r = (await Service().SearchAsync("daves killer bread")).Results;
        Assert.Equal(110, r[0].PerServing!.Calories);
        Assert.Equal("1 slice (40 g)", r[0].ServingDescription);
        Assert.Null(r[1].PerServing);                      // no labelled size: per 100 g only, nothing made up
    }

    [Fact]
    public void Missing_calories_are_calculated_from_macros_and_labelled_or_left_unknown()
    {
        var (done, calculated) = BrandedFoodService.Complete(P("1", "Yogurt", "Chobani", kcal: null));
        Assert.True(calculated);
        Assert.Equal(10 * 4 + 5 * 4 + 2 * 9, done.Per100.Get(NutrientIds.Energy));
        var food = BrandedFoodService.ToFood(P("1", "Yogurt", "Chobani", kcal: null));
        Assert.Contains("Calories calculated", food.QualityNote);

        var noMacros = new BrandedProduct(FoodSource.UsdaBranded, "2", "Mystery", null, null, new NutrientProfile(new Dictionary<int, double> { [NutrientIds.Protein] = 3 }), NutrientBasis.Mass, [], null);
        var (same, calc2) = BrandedFoodService.Complete(noMacros);
        Assert.False(calc2);
        Assert.False(same.Per100.Has(NutrientIds.Energy)); // not enough data: stays unknown, never zero

        var (kept, calc3) = BrandedFoodService.Complete(P("3", "Bread", "X", kcal: 250));
        Assert.False(calc3);
        Assert.Equal(250, kept.Per100.Get(NutrientIds.Energy)); // a label's own calories are never replaced
    }

    [Fact]
    public async Task Adding_a_product_saves_it_once_and_marks_search_results_as_saved()
    {
        _provider.Products = [P("42", "Greek Yogurt", "Chobani", serving: 170)];
        var first = await Service().AddAsync("42");
        var again = await Service().AddAsync("42");
        Assert.Equal(first.Id, again.Id);
        Assert.Single(_store.Foods);
        Assert.Equal(1, _provider.Gets);
        Assert.Equal(first.Id, (await Service().SearchAsync("chobani greek yogurt")).Results.Single().LocalFoodId);
    }

    [Fact]
    public async Task A_product_already_scanned_under_its_barcode_is_reused()
    {
        var scanned = new Food("Granola", FoodSource.OpenFoodFacts, new NutrientProfile(new Dictionary<int, double> { [NutrientIds.Energy] = 450 }), barcode: "0012345678905");
        _store.Foods.Add(scanned);
        _provider.Products = [P("7", "Granola", "Acme", barcode: "0012345678905")];
        Assert.Equal(scanned.Id, (await Service().AddAsync("7")).Id);
        Assert.Single(_store.Foods);
    }

    [Fact]
    public async Task A_stale_label_is_refreshed_but_a_verified_food_is_never_overwritten()
    {
        _provider.Products = [P("9", "Bar", "Acme", kcal: 400)];
        await Service().AddAsync("9");
        var food = _store.Foods.Single();
        typeof(Food).GetProperty(nameof(Food.UpdatedAt))!.SetValue(food, DateTimeOffset.UtcNow.AddDays(-120));
        _provider.Products = [P("9", "Bar", "Acme", kcal: 380)];
        await Service().AddAsync("9");
        Assert.Equal(380, food.NutrientsPer100g.Get(NutrientIds.Energy));

        food.MarkVerified();
        typeof(Food).GetProperty(nameof(Food.UpdatedAt))!.SetValue(food, DateTimeOffset.UtcNow.AddDays(-120));
        _provider.Products = [P("9", "Bar", "Acme", kcal: 999)];
        await Service().AddAsync("9");
        Assert.Equal(380, food.NutrientsPer100g.Get(NutrientIds.Energy));
    }

    [Fact]
    public async Task A_refresh_that_fails_keeps_the_saved_label()
    {
        _provider.Products = [P("9", "Bar", "Acme", kcal: 400)];
        await Service().AddAsync("9");
        var food = _store.Foods.Single();
        typeof(Food).GetProperty(nameof(Food.UpdatedAt))!.SetValue(food, DateTimeOffset.UtcNow.AddDays(-120));
        _provider.Failure = ProviderFailure.Timeout;
        var r = await Service().AddAsync("9");
        Assert.Equal(400, r.Per100g.Calories);
    }

    [Fact]
    public async Task Adding_while_the_provider_is_down_is_a_temporary_failure()
    {
        _provider.Failure = ProviderFailure.Network;
        await Assert.ThrowsAsync<ProviderUnavailableException>(() => Service().AddAsync("5"));
        _provider.Failure = null;
        await Assert.ThrowsAsync<NotFoundException>(() => Service().AddAsync("5"));
        await Assert.ThrowsAsync<ValidationException>(() => Service().AddAsync("../etc"));
    }

    // ---- Drinks labelled per 100 ml ----

    private Food Shake()
    {
        var f = BrandedFoodService.ToFood(P("11", "High Protein Shake", "Premier Protein", kcal: 48, basis: NutrientBasis.Volume, serving: 330, servingWord: "shake"));
        _store.Foods.Add(f);
        return f;
    }

    [Fact]
    public void Volume_foods_convert_volumes_exactly_and_refuse_weights()
    {
        var shake = Shake();
        Assert.Equal(330, QuantityResolver.Resolve(shake, 1, "shake").Grams);            // the labelled serving, in ml
        Assert.Equal(236.6, QuantityResolver.Resolve(shake, 1, "cup").Grams!.Value, 1);  // exact ml
        Assert.Equal(ResolutionMethod.Volume, QuantityResolver.Resolve(shake, 8, "fl oz").Method);
        var weight = QuantityResolver.Resolve(shake, 100, "g");
        Assert.Null(weight.Grams);                                                          // no invented density
        Assert.Contains("per 100 ml", weight.Explanation);
    }

    [Fact]
    public async Task Logging_a_drink_records_ml_and_no_gram_weight()
    {
        var shake = Shake();
        var diary = new DiaryService(_store, _store, _store, _store, _store, _store);
        var byServing = await diary.LogFoodAsync(new LogFoodRequest(_store.Today, MealSlot.Breakfast, shake.Id, null, 1, "shake"));
        Assert.Null(byServing.Item.Grams);
        Assert.Equal("shake", byServing.Item.Unit);
        Assert.Equal(158.4, byServing.Item.Nutrition.Calories, 1);
        var byMl = await diary.LogFoodAsync(new LogFoodRequest(_store.Today, MealSlot.Breakfast, shake.Id, 250, null, null));
        Assert.Equal("ml", byMl.Item.Unit);
        Assert.Equal(250, byMl.Item.Quantity);
        Assert.Null(byMl.Item.Grams);
        Assert.Equal(120, byMl.Item.Nutrition.Calories, 1);
    }

    [Fact]
    public async Task Drinks_are_never_matched_as_recipe_ingredients_or_gap_suggestions()
    {
        Shake();
        var foods = new FoodService(_store, [], _store);
        var ranked = await foods.SearchRankedAsync("protein shake", 10);
        Assert.Contains(ranked, r => r.Food.IsVolume);  // still findable to log
        var recipes = new Recipes.RecipeService(_store, _store, foods, new NoWeb(), _store);
        var created = await recipes.CreateAsync(new Recipes.SaveRecipeRequest("Smoothie", 1, ["1 cup protein shake"], null, null, null, null, null));
        Assert.NotEqual(_store.Foods.Single(f => f.IsVolume).Id, created.Ingredients.Single().FoodId);
    }

    [Fact]
    public async Task Barcode_scans_try_the_branded_provider_and_save_the_product_once()
    {
        _provider.Products = [P("21", "White Bread", "Dave's Killer Bread", barcode: "0013764027220", serving: 40, servingWord: "slice")];
        var usda = new BrandedBarcode(_provider);
        var foods = new FoodService(_store, [usda], _store);
        var r = await foods.LookupBarcodeAsync("013764027220");
        Assert.Equal("White Bread", r.Food!.Name);
        Assert.Equal("UsdaBranded", r.Food.Source);
        await foods.LookupBarcodeAsync("013764027220");
        Assert.Single(_store.Foods);
    }

    [Fact]
    public async Task A_generic_search_keeps_generic_USDA_foods_ahead_of_a_saved_store_brand()
    {
        _store.AddFood("Chicken, broilers or fryers, breast, meat only, raw", 120, 22.5, 0, 2.6);
        _store.Foods.Add(BrandedFoodService.ToFood(P("31", "Chicken Breast", "Giant Eagle", kcal: 165)));
        var top = (await new FoodService(_store, [], _store).SearchRankedAsync("chicken breast", 5))[0];
        Assert.Equal(FoodSource.UsdaSrLegacy, top.Food.Source);
    }

    [Fact]
    public async Task A_brand_search_finds_the_saved_branded_product_first()
    {
        _store.AddFood("Yogurt, Greek, plain, nonfat", 59, 10, 3.6, 0.4);
        _store.Foods.Add(BrandedFoodService.ToFood(P("32", "Plain Non-Fat Greek Yogurt", "Chobani", kcal: 53)));
        var top = (await new FoodService(_store, [], _store).SearchRankedAsync("chobani greek yogurt", 5))[0];
        Assert.Equal("Chobani", top.Food.Brand);
    }

    private sealed class BrandedBarcode(IBrandedFoodProvider p) : IBarcodeProvider
    {
        public string Name => "usda";
        public async Task<BarcodeLookup> LookupAsync(string code, CancellationToken ct = default) =>
            (await p.FindByBarcodeAsync(code, ct)).Product is { } x ? BarcodeLookup.Found(BrandedFoodService.ToFood(x)) : BarcodeLookup.NotFound;
    }

    private sealed class NoWeb : IWebPageFetcher
    {
        public Task<string> GetHtmlAsync(Uri url, CancellationToken ct = default) => throw new NotSupportedException();
    }
}
