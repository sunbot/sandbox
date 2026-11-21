using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using NutriPlan.Infrastructure.Persistence;

namespace NutriPlan.Infrastructure.Usda;

/// <summary>
/// On first start of a fresh deployment, imports every USDA folder (one containing food.csv) found under
/// <c>Usda:SeedFolder</c>. Runs in the background so the app is reachable immediately; search fills in within a minute.
/// Does nothing once foods exist, so restarts are free.
/// </summary>
public sealed class UsdaSeeder(IServiceProvider services, IConfiguration config, ILogger<UsdaSeeder> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var root = config["Usda:SeedFolder"];
        if (string.IsNullOrWhiteSpace(root) || !Directory.Exists(root)) return;

        using var scope = services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NutriPlanDbContext>();
        if (await db.Foods.AnyAsync(stoppingToken)) return;

        var folders = Directory.GetFiles(root, "food.csv", SearchOption.AllDirectories).Select(Path.GetDirectoryName).OfType<string>().Order().ToList();
        logger.LogInformation("Empty food database: importing {Count} USDA dataset(s) from {Root}", folders.Count, root);
        var importer = scope.ServiceProvider.GetRequiredService<UsdaImporter>();
        foreach (var folder in folders)
        {
            try
            {
                var result = await importer.ImportAsync(folder, stoppingToken);
                logger.LogInformation("{Dataset}: imported {Imported}", result.Dataset, result.Imported);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogError(ex, "USDA import failed for {Folder}", folder);
            }
        }
    }
}
