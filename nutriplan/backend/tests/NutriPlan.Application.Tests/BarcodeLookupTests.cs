using NutriPlan.Application.Abstractions;
using NutriPlan.Application.Common;
using NutriPlan.Application.Foods;
using NutriPlan.Domain.Foods;
using NutriPlan.Domain.Nutrients;

namespace NutriPlan.Application.Tests;

/// <summary>Barcode lookup order (local → providers) and honest outcomes.</summary>
public class BarcodeLookupTests
{
    private readonly InMemoryStore _store = new();

    private sealed class Fixed(BarcodeLookup result, string name = "fake") : IBarcodeProvider
    {
        public int Calls { get; private set; }
        public string Name => name;
        public Task<BarcodeLookup> LookupAsync(string normalizedBarcode, CancellationToken ct = default) { Calls++; return Task.FromResult(result); }
    }

    private static Food Product(string barcode) =>
        new("Granola", FoodSource.OpenFoodFacts, new NutrientProfile(new Dictionary<int, double> { [NutrientIds.Energy] = 450 }), barcode: barcode);

    private FoodService Service(params IBarcodeProvider[] providers) => new(_store, providers, _store);

    private const string Upc = "012345678905";       // valid UPC-A → 0012345678905

    [Fact]
    public async Task Local_foods_answer_first_and_no_provider_is_called()
    {
        _store.Foods.Add(Product("0012345678905"));
        var p = new Fixed(BarcodeLookup.Failed(ProviderFailure.Network));
        var r = await Service(p).LookupBarcodeAsync(Upc);
        Assert.Equal("Granola", r.Food!.Name);
        Assert.Equal(0, p.Calls);
    }

    [Fact]
    public async Task Not_found_only_when_every_provider_answered_so()
    {
        var r = await Service(new Fixed(BarcodeLookup.NotFound), new Fixed(BarcodeLookup.NotFound)).LookupBarcodeAsync(Upc);
        Assert.Null(r.Food);
        Assert.Null(r.Failure);
    }

    [Fact]
    public async Task A_provider_failure_is_reported_as_temporary_not_as_not_found()
    {
        var r = await Service(new Fixed(BarcodeLookup.Failed(ProviderFailure.Timeout)), new Fixed(BarcodeLookup.NotFound)).LookupBarcodeAsync(Upc);
        Assert.Null(r.Food);
        Assert.Equal(ProviderFailure.Timeout, r.Failure);
    }

    [Fact]
    public async Task A_later_provider_can_still_find_it_after_one_fails_and_it_is_saved_once()
    {
        var found = new Fixed(BarcodeLookup.Found(Product("0012345678905")));
        var r = await Service(new Fixed(BarcodeLookup.Failed(ProviderFailure.RateLimited)), found).LookupBarcodeAsync(Upc);
        Assert.Equal("Granola", r.Food!.Name);
        Assert.Single(_store.Foods);
        await Service(found).LookupBarcodeAsync(Upc);           // second scan: local, no duplicate
        Assert.Single(_store.Foods);
        Assert.Equal(1, found.Calls);
    }

    [Theory]
    [InlineData("abc")]
    [InlineData("12345")]
    [InlineData("0012345678906")]   // wrong check digit
    public async Task An_invalid_barcode_is_rejected_without_calling_providers(string code)
    {
        var p = new Fixed(BarcodeLookup.NotFound);
        await Assert.ThrowsAsync<ValidationException>(() => Service(p).LookupBarcodeAsync(code));
        Assert.Equal(0, p.Calls);
    }

    [Theory]
    [InlineData("0012345678905", true)]
    [InlineData("5000159484695", true)]    // EAN-13
    [InlineData("96385074", true)]         // EAN-8 / UPC-E: not checksummed here
    [InlineData("10012345678902", true)]   // GTIN-14
    [InlineData("0012345678906", false)]
    [InlineData("123456789", false)]
    public void Plausible_barcodes(string code, bool ok) => Assert.Equal(ok, Food.IsPlausibleBarcode(code));
}
