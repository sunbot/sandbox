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
    /// <summary>
    /// One-time, opt-in data step for an existing database: set <c>Usda:EnrichPortions</c> to <c>dry-run</c> (logs what would change,
    /// saves nothing) or <c>apply</c> (gives Foundation foods that have no portions their NDB-linked SR Legacy food's measures, see
    /// <see cref="UsdaPortionEnricher"/>). Idempotent; remove the setting afterwards.
    /// </summary>
    private async Task EnrichExistingAsync(IServiceProvider sp, string root, CancellationToken ct)
    {
        var mode = config["Usda:EnrichPortions"]?.Trim().ToLowerInvariant();
        if (mode is not ("dry-run" or "apply")) return;
        var folders = Directory.GetFiles(root, "food.csv", SearchOption.AllDirectories).Select(Path.GetDirectoryName).OfType<string>().Order().ToList();
        try
        {
            var result = await sp.GetRequiredService<UsdaPortionEnricher>().RunAsync(folders, apply: mode == "apply", ct);
            foreach (var c in result.Changes)
                logger.LogInformation("USDA portion enrichment ({Mode}): {Food} <- {Donor} (SR {Sr}, NDB {Ndb}): {Portions}", mode, c.FoodName, c.DonorName, c.DonorFdcId, c.Ndb,
                    string.Join("; ", c.Portions.Select(p => $"{p.Description} = {p.GramsPerUnit:0.##} g")));
            foreach (var r in result.Rejected) logger.LogInformation("USDA portion enrichment ({Mode}): left without measures: {Reason}", mode, r);
            logger.LogWarning("USDA portion enrichment ({Mode}): {Changed} of {Candidates} linked Foundation foods without portions {Verb}. Remove Usda__EnrichPortions now.",
                mode, result.Changes.Count, result.Candidates, mode == "apply" ? "updated" : "would be updated");
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogError(ex, "USDA portion enrichment failed");
        }
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var root = config["Usda:SeedFolder"];
        if (string.IsNullOrWhiteSpace(root) || !Directory.Exists(root)) return;

        using var scope = services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<NutriPlanDbContext>();
        if (await db.Foods.AnyAsync(stoppingToken))
        {
            await EnrichExistingAsync(scope.ServiceProvider, root, stoppingToken);
            return;
        }

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
        // A fresh database: give Foundation foods without portions their linked SR Legacy food's measures (needs both downloads).
        if (!folders.Any(f => File.Exists(Path.Combine(f, "foundation_food.csv"))) || !folders.Any(f => File.Exists(Path.Combine(f, "sr_legacy_food.csv")))) return;
        try
        {
            await scope.ServiceProvider.GetRequiredService<UsdaPortionEnricher>().RunAsync(folders, apply: true, stoppingToken);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogError(ex, "USDA portion enrichment failed");
        }
    }
}
