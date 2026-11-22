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
        // DATABASE_URL (what most hosts provide) wins over appsettings so a deployment needs no config files.
        // Neon writes both DATABASE_URL (pooled) and DATABASE_URL_UNPOOLED (direct). The app creates/updates its tables
        // at startup, which needs a direct connection, and a single-user app needs few connections, so prefer direct.
        var raw = config["DATABASE_URL_UNPOOLED"] ?? config["DATABASE_URL"] ?? config.GetConnectionString("NutriPlan")
            ?? throw new InvalidOperationException("Set DATABASE_URL or ConnectionStrings:NutriPlan.");
        var connectionString = ConnectionStrings.FromUrlOrRaw(raw);

        services.AddDbContext<NutriPlanDbContext>(o => o.UseNpgsql(connectionString).UseSnakeCaseNamingConvention());
        services.AddScoped<IUnitOfWork>(sp => sp.GetRequiredService<NutriPlanDbContext>());
        services.AddScoped<IFoodRepository, FoodRepository>();
        services.AddScoped<IRecipeRepository, RecipeRepository>();
        services.AddScoped<IDiaryRepository, DiaryRepository>();
        services.AddScoped<IPlanRepository, PlanRepository>();
        services.AddScoped<IPantryRepository, PantryRepository>();
        services.AddScoped<ITargetsRepository, TargetsRepository>();
        services.AddScoped<IUserDirectory, UserDirectory>();
        services.AddScoped<UsdaImporter>();
        services.AddHostedService<UsdaSeeder>();

        services.Configure<AppOptions>(config.GetSection(AppOptions.Section));
        services.AddSingleton<IClock, SystemClock>();

        var appOptions = config.GetSection(AppOptions.Section).Get<AppOptions>() ?? new AppOptions();
        // USDA Branded: text search and barcodes (manufacturer labels). Registered before Open Food Facts so barcode
        // lookups try USDA first. Without Usda:ApiKey both quietly do nothing.
        services.Configure<UsdaOptions>(config.GetSection(UsdaOptions.Section));
        services.AddHttpClient<IBrandedFoodProvider, UsdaBrandedProvider>(c =>
        {
            c.BaseAddress = new Uri("https://api.nal.usda.gov/fdc/v1/");
            c.Timeout = TimeSpan.FromSeconds(6);
        });
        services.AddScoped<IBarcodeProvider, UsdaBarcodeProvider>();
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
    private readonly TimeZoneInfo _zone = Resolve(options.Value.TimeZone);

    /// <summary>Unknown or missing zone names fall back to the server's zone instead of crashing the app.</summary>
    private static TimeZoneInfo Resolve(string? id)
    {
        if (string.IsNullOrWhiteSpace(id)) return TimeZoneInfo.Local;
        return TimeZoneInfo.TryFindSystemTimeZoneById(id.Trim(), out var zone) ? zone : TimeZoneInfo.Local;
    }

    public DateTimeOffset Now => TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, _zone);
    public DateOnly Today => DateOnly.FromDateTime(Now.DateTime);
}
