using System.Net;
using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using NutriPlan.Application.Abstractions;
using NutriPlan.Domain.Foods;
using NutriPlan.Domain.Nutrients;
using NutriPlan.Infrastructure.External;

namespace NutriPlan.Infrastructure.Tests;

/// <summary>USDA FoodData Central Branded: normalization of real-shaped responses, and failures (all mocked, no network).</summary>
public class UsdaBrandedProviderTests
{
    private const string SearchJson = """
    {"totalHits":3,"foods":[
      {"fdcId":2755534,"description":"DAVE'S KILLER BREAD, WHITE BREAD","brandName":"DAVE'S KILLER BREAD","brandOwner":"Avb Corp.","gtinUpc":"013764027220",
       "servingSize":40.0,"servingSizeUnit":"GRM","householdServingFullText":"1 SLICE","modifiedDate":"2023-04-27",
       "foodNutrients":[{"nutrientId":1008,"unitName":"KCAL","value":275},{"nutrientId":1003,"unitName":"G","value":7.5},{"nutrientId":1005,"unitName":"G","value":52.5},
                        {"nutrientId":1004,"unitName":"G","value":5.0},{"nutrientId":1104,"unitName":"IU","value":0},{"nutrientId":1093,"unitName":"MG","value":425},{"nutrientId":1079,"unitName":"G","value":0}]},
      {"fdcId":111,"description":"HIGH PROTEIN SHAKE, CHOCOLATE, CHOCOLATE","brandName":"PREMIER PROTEIN","gtinUpc":"643843715009",
       "servingSize":330.0,"servingSizeUnit":"ml","householdServingFullText":"1 SHAKE",
       "foodNutrients":[{"nutrientId":1008,"unitName":"KCAL","value":48},{"nutrientId":1003,"unitName":"G","value":9.1},{"nutrientId":1005,"unitName":"G","value":1.5},{"nutrientId":1004,"unitName":"G","value":0.9}]},
      {"fdcId":222,"description":"Chobani Plain Low- Fat Greek Yogurt","brandOwner":"Chobani","gtinUpc":"00894700010199","servingSize":180,"servingSizeUnit":"g",
       "foodNutrients":[{"nutrientId":1003,"unitName":"G","value":9.4},{"nutrientId":1005,"unitName":"G","value":3.9},{"nutrientId":1004,"unitName":"G","value":1.9}]}
    ]}
    """;

    private static UsdaBrandedProvider Provider(Func<HttpRequestMessage, Task<HttpResponseMessage>> respond, string? key = "test-key", TimeSpan? timeout = null) =>
        new(new HttpClient(new Stub(respond)) { BaseAddress = new Uri("https://api.nal.usda.gov/fdc/v1/"), Timeout = timeout ?? TimeSpan.FromSeconds(5) },
            Options.Create(new UsdaOptions { ApiKey = key }), NullLogger<UsdaBrandedProvider>.Instance);

    private sealed class Stub(Func<HttpRequestMessage, Task<HttpResponseMessage>> respond) : HttpMessageHandler
    {
        public List<HttpRequestMessage> Requests { get; } = [];
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage r, CancellationToken ct) => respond(r);
    }

    private static Task<HttpResponseMessage> Json(string body, HttpStatusCode code = HttpStatusCode.OK) => Task.FromResult(new HttpResponseMessage(code) { Content = new StringContent(body) });

    [Fact]
    public async Task Search_results_are_normalized_without_inventing_anything()
    {
        HttpRequestMessage? seen = null;
        var r = await Provider(req => { seen = req; return Json(SearchJson); }).SearchAsync("dave's killer bread", 50);
        Assert.Null(r.Failure);
        Assert.Equal(3, r.Products.Count);
        Assert.Equal("test-key", seen!.Headers.GetValues("X-Api-Key").Single());
        Assert.DoesNotContain("api_key", seen.RequestUri!.Query); // the key is a header, never in a URL
        Assert.Contains("dataType=Branded", seen.RequestUri.Query);

        var bread = r.Products[0];
        Assert.Equal("2755534", bread.SourceId);
        Assert.Equal("Dave's Killer Bread", bread.Brand);
        Assert.Equal("White Bread", bread.Name);                       // brand prefix removed, title-cased
        Assert.Equal("0013764027220", bread.Barcode);                  // UPC-A normalized to EAN-13
        Assert.Equal(NutrientBasis.Mass, bread.Basis);
        Assert.Equal(new FoodPortion("slice", 40), Assert.Single(bread.Portions));
        Assert.Equal(275, bread.Per100.Get(NutrientIds.Energy));
        Assert.True(bread.Per100.Has(NutrientIds.Fiber));                // reported zero stays zero
        Assert.Equal(0, bread.Per100.Get(NutrientIds.Fiber));
        Assert.False(bread.Per100.Has(NutrientIds.VitaminA));            // IU isn't µg RAE: left out, not converted
        Assert.Equal(new DateOnly(2023, 4, 27), bread.LabelDate);

        var shake = r.Products[1];
        Assert.Equal(NutrientBasis.Volume, shake.Basis);                 // labelled in ml: per 100 ml, no density
        Assert.Equal("High Protein Shake, Chocolate", shake.Name);       // repeated segment dropped
        Assert.Equal(330, shake.Portions[0].GramWeight);

        var yogurt = r.Products[2];
        Assert.False(yogurt.Per100.Has(NutrientIds.Energy));             // no calories on this label: still unknown here
        Assert.Equal(new FoodPortion("serving", 180), yogurt.Portions[0]);
    }

    [Fact]
    public void Detail_documents_use_the_nested_nutrient_shape()
    {
        using var doc = JsonDocument.Parse("""
        {"fdcId":2755534,"description":"Chobani Honey Vanilla Greek Yogurt","brandOwner":"Chobani","servingSize":150,"servingSizeUnit":"g","householdServingFullText":"0.5 CUP",
         "foodNutrients":[{"nutrient":{"id":1003,"unitName":"g"},"amount":8.0},{"nutrient":{"id":1008,"unitName":"kcal"},"amount":93.3},{"nutrient":{"id":1106,"unitName":"µg"},"amount":12}]}
        """);
        var p = UsdaBrandedProvider.Parse(doc.RootElement)!;
        Assert.Equal(93.3, p.Per100.Get(NutrientIds.Energy));
        Assert.Equal(12, p.Per100.Get(NutrientIds.VitaminA));
        Assert.Equal("0.5 cup serving", p.Portions[0].Description);   // the label's serving stays one tap
        Assert.Equal(150, p.Portions[0].GramWeight);
    }

    [Theory]
    [InlineData("11.5 OZA", "11.5 fl oz serving")]
    [InlineData("1 ONZ", "oz")]
    [InlineData("2 tbsp", "2 tbsp serving")]
    [InlineData("1 BOTTLE", "bottle")]
    [InlineData("about 3 crackers", "serving")]
    [InlineData(null, "serving")]
    public void Label_unit_codes_read_as_words(string? household, string expected)
    {
        var json = $$"""{"fdcId":1,"description":"X","servingSize":30,"servingSizeUnit":"g","householdServingFullText":{{(household is null ? "null" : $"\"{household}\"")}},"foodNutrients":[{"nutrientId":1003,"unitName":"G","value":1}]}""";
        using var doc = JsonDocument.Parse(json);
        Assert.Equal(expected, UsdaBrandedProvider.Parse(doc.RootElement)!.Portions[0].Description);
    }

    [Fact]
    public void A_serving_in_an_unknown_unit_is_not_turned_into_grams()
    {
        using var doc = JsonDocument.Parse("""{"fdcId":1,"description":"X","servingSize":1,"servingSizeUnit":"ONZ","foodNutrients":[{"nutrientId":1003,"unitName":"G","value":1}]}""");
        Assert.Empty(UsdaBrandedProvider.Parse(doc.RootElement)!.Portions);
    }

    [Theory]
    [InlineData(HttpStatusCode.TooManyRequests, ProviderFailure.RateLimited)]
    [InlineData(HttpStatusCode.ServiceUnavailable, ProviderFailure.Network)]
    [InlineData(HttpStatusCode.Forbidden, ProviderFailure.BadResponse)]   // bad or revoked key
    public async Task Provider_errors_are_reported_not_thrown(HttpStatusCode code, ProviderFailure why) =>
        Assert.Equal(why, (await Provider(_ => Json("{}", code)).SearchAsync("x", 10)).Failure);

    [Fact]
    public async Task Timeouts_network_errors_and_garbage_are_failures()
    {
        Assert.Equal(ProviderFailure.Timeout, (await Provider(async _ => { await Task.Delay(3000); return new HttpResponseMessage(); }, timeout: TimeSpan.FromMilliseconds(80)).SearchAsync("x", 10)).Failure);
        Assert.Equal(ProviderFailure.Network, (await Provider(_ => throw new HttpRequestException("dns")).SearchAsync("x", 10)).Failure);
        Assert.Equal(ProviderFailure.BadResponse, (await Provider(_ => Json("<html>")).SearchAsync("x", 10)).Failure);
        Assert.Equal(ProviderFailure.BadResponse, (await Provider(_ => Json("""{"nope":1}""")).SearchAsync("x", 10)).Failure);
    }

    [Fact]
    public async Task Without_a_key_nothing_is_sent()
    {
        var called = false;
        var p = Provider(_ => { called = true; return Json(SearchJson); }, key: null);
        Assert.False(p.IsConfigured);
        await p.SearchAsync("x", 10);
        Assert.False(called);
        Assert.Equal(BarcodeLookupStatus.NotFound, (await new UsdaBarcodeProvider(p).LookupAsync("0013764027220")).Status);
    }

    [Fact]
    public async Task Barcode_lookup_matches_the_normalized_code_exactly()
    {
        var p = Provider(_ => Json(SearchJson));
        var found = await new UsdaBarcodeProvider(p).LookupAsync("0013764027220");
        Assert.Equal(BarcodeLookupStatus.Found, found.Status);
        Assert.Equal("White Bread", found.Food!.Name);
        Assert.Equal(FoodSource.UsdaBranded, found.Food.Source);
        Assert.Equal(BarcodeLookupStatus.NotFound, (await new UsdaBarcodeProvider(p).LookupAsync("0000000000017")).Status);
        Assert.Equal(BarcodeLookupStatus.Failed, (await new UsdaBarcodeProvider(Provider(_ => Json("{}", HttpStatusCode.TooManyRequests))).LookupAsync("0013764027220")).Status);
    }
}
