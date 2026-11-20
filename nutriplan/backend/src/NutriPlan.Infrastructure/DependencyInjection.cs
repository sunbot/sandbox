using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using NutriPlan.Application.Abstractions;
using NutriPlan.Infrastructure.Ai;
using NutriPlan.Infrastructure.External;
using NutriPlan.Infrastructure.Persistence;
using NutriPlan.Infrastructure.Usda;

namespace NutriPlan.Infrastructure;

public sealed class AppOptions
{
    public const string Section = "App";
    /// <summary>IANA time zone used for "today" (e.g. "America/Chicago"). Empty = server's local zone.</summary>
    public string? TimeZone { get; set; }
    /// <summary>Contact string sent to Open Food Facts in the User-Agent, as their API asks. Keep it generic.</summary>
    public string OpenFoodFactsUserAgent { get; set; } = "NutriPlan/0.1 (personal nutrition tracker)";
}

public static class DependencyInjection
{
    public static IServiceCollection AddInfrastructure(this IServiceCollection services, IConfiguration config)
    {
        var connectionString = config.GetConnectionString("NutriPlan")
            ?? throw new InvalidOperationException("Connection string 'NutriPlan' is missing.");

        services.AddDbContext<NutriPlanDbContext>(o => o.UseNpgsql(connectionString).UseSnakeCaseNamingConvention());
        services.AddScoped<IUnitOfWork>(sp => sp.GetRequiredService<NutriPlanDbContext>());
        services.AddScoped<IFoodRepository, FoodRepository>();
        services.AddScoped<IRecipeRepository, RecipeRepository>();
        services.AddScoped<IDiaryRepository, DiaryRepository>();
        services.AddScoped<IPlanRepository, PlanRepository>();
        services.AddScoped<IPantryRepository, PantryRepository>();
        services.AddScoped<ITargetsRepository, TargetsRepository>();
        services.AddScoped<UsdaImporter>();

        services.Configure<AppOptions>(config.GetSection(AppOptions.Section));
        services.AddSingleton<IClock, SystemClock>();

        var appOptions = config.GetSection(AppOptions.Section).Get<AppOptions>() ?? new AppOptions();
        services.AddHttpClient<IBarcodeProvider, OpenFoodFactsProvider>(c =>
        {
            c.BaseAddress = new Uri("https://world.openfoodfacts.org/");
            c.Timeout = TimeSpan.FromSeconds(10);
            c.DefaultRequestHeaders.UserAgent.ParseAdd(appOptions.OpenFoodFactsUserAgent);
        });
        services.AddHttpClient<IWebPageFetcher, HttpWebPageFetcher>(c =>
        {
            c.Timeout = TimeSpan.FromSeconds(15);
            c.DefaultRequestHeaders.UserAgent.ParseAdd("Mozilla/5.0 (compatible; NutriPlan recipe importer)");
            c.DefaultRequestHeaders.Accept.ParseAdd("text/html,application/xhtml+xml");
        }).ConfigurePrimaryHttpMessageHandler(HttpWebPageFetcher.CreatePublicOnlyHandler);

        services.Configure<ClaudeOptions>(config.GetSection(ClaudeOptions.Section));
        services.AddSingleton<ClaudeJsonClient>();
        services.AddSingleton<ILanguageInterpreter, ClaudeInterpreter>();
        services.AddSingleton<IRecipeIdeaGenerator, ClaudeRecipeIdeaGenerator>();

        return services;
    }
}

public sealed class SystemClock(Microsoft.Extensions.Options.IOptions<AppOptions> options) : IClock
{
    private readonly TimeZoneInfo _zone = string.IsNullOrWhiteSpace(options.Value.TimeZone)
        ? TimeZoneInfo.Local
        : TimeZoneInfo.FindSystemTimeZoneById(options.Value.TimeZone);

    public DateTimeOffset Now => TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, _zone);
    public DateOnly Today => DateOnly.FromDateTime(Now.DateTime);
}
