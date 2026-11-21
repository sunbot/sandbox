using System.Net;
using Microsoft.Extensions.Logging.Abstractions;
using NutriPlan.Application.Abstractions;
using NutriPlan.Infrastructure.External;

namespace NutriPlan.Infrastructure.Tests;

/// <summary>Open Food Facts lookups: a temporary failure is never reported as "not found".</summary>
public class BarcodeProviderTests
{
    private sealed class Stub(Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> respond) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct) => respond(request, ct);
    }

    private static OpenFoodFactsProvider Provider(Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> respond, TimeSpan? timeout = null) =>
        new(new HttpClient(new Stub(respond)) { BaseAddress = new Uri("https://world.openfoodfacts.org/"), Timeout = timeout ?? TimeSpan.FromSeconds(5) },
            NullLogger<OpenFoodFactsProvider>.Instance);

    private static Task<HttpResponseMessage> Reply(HttpStatusCode code, string body = "") =>
        Task.FromResult(new HttpResponseMessage(code) { Content = new StringContent(body) });

    private const string Granola = """{"status":1,"product":{"product_name":"Granola","brands":"Acme","nutriments":{"energy-kcal_100g":450,"proteins_100g":10,"carbohydrates_100g":60,"fat_100g":18},"serving_quantity":40,"serving_size":"40 g"}}""";

    [Fact]
    public async Task A_known_product_is_found()
    {
        var r = await Provider((_, _) => Reply(HttpStatusCode.OK, Granola)).LookupAsync("0012345678905");
        Assert.Equal(BarcodeLookupStatus.Found, r.Status);
        Assert.Equal("Granola", r.Food!.Name);
    }

    [Theory]
    [InlineData(HttpStatusCode.NotFound, """{"status":0}""")]
    [InlineData(HttpStatusCode.OK, """{"status":0}""")]
    [InlineData(HttpStatusCode.OK, """{"status":1,"product":{"product_name":"No nutrition"}}""")]
    public async Task An_unknown_code_or_a_product_without_nutrition_is_not_found(HttpStatusCode code, string body) =>
        Assert.Equal(BarcodeLookupStatus.NotFound, (await Provider((_, _) => Reply(code, body)).LookupAsync("0012345678905")).Status);

    [Theory]
    [InlineData(HttpStatusCode.TooManyRequests, ProviderFailure.RateLimited)]
    [InlineData(HttpStatusCode.ServiceUnavailable, ProviderFailure.Network)]
    [InlineData(HttpStatusCode.BadGateway, ProviderFailure.Network)]
    [InlineData(HttpStatusCode.Forbidden, ProviderFailure.BadResponse)]
    public async Task Server_trouble_is_a_failure_not_a_missing_product(HttpStatusCode code, ProviderFailure why)
    {
        var r = await Provider((_, _) => Reply(code, "busy")).LookupAsync("0012345678905");
        Assert.Equal(BarcodeLookupStatus.Failed, r.Status);
        Assert.Equal(why, r.Failure);
    }

    [Fact]
    public async Task An_unreadable_response_is_a_failure()
    {
        var r = await Provider((_, _) => Reply(HttpStatusCode.OK, "<html>maintenance</html>")).LookupAsync("0012345678905");
        Assert.Equal(ProviderFailure.BadResponse, r.Failure);
    }

    [Fact]
    public async Task No_network_is_a_failure()
    {
        var r = await Provider((_, _) => throw new HttpRequestException("DNS")).LookupAsync("0012345678905");
        Assert.Equal(ProviderFailure.Network, r.Failure);
    }

    [Fact]
    public async Task A_slow_provider_times_out_as_a_failure()
    {
        var r = await Provider(async (_, ct) => { await Task.Delay(5000, ct); return new HttpResponseMessage(HttpStatusCode.OK); }, TimeSpan.FromMilliseconds(100))
            .LookupAsync("0012345678905");
        Assert.Equal(ProviderFailure.Timeout, r.Failure);
    }

    [Fact]
    public async Task Cancelling_the_request_is_not_reported_as_a_timeout()
    {
        using var cts = new CancellationTokenSource();
        cts.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            Provider(async (_, ct) => { await Task.Delay(5000, ct); return new HttpResponseMessage(HttpStatusCode.OK); }).LookupAsync("0012345678905", cts.Token));
    }
}
