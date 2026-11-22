using System.Globalization;
using CsvHelper;
using CsvHelper.Configuration;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using NutriPlan.Domain.Foods;
using NutriPlan.Infrastructure.Persistence;

namespace NutriPlan.Infrastructure.Usda;

public sealed record PortionEnrichment(Guid FoodId, string FoodName, string DonorName, long DonorFdcId, string Ndb, IReadOnlyList<FoodPortion> Portions);

public sealed record PortionEnrichmentResult(int Candidates, IReadOnlyList<PortionEnrichment> Changes, IReadOnlyList<string> Rejected, bool Applied);

/// <summary>
/// Gives already-imported USDA Foundation foods that have no portions the measured portions of the SR Legacy food USDA
/// links them to (same NDB number), where <see cref="EquivalentPortions"/> shows they're the same physical food. The
/// importer skips foods it has already imported, so re-importing would never add these.
///
/// Safe to re-run: only foods with no portions at all are touched, nutrition, names and ids are never changed, and every
/// borrowed portion records its origin. Without <c>apply</c> it only reports what it would do.
/// Undo: set <c>portions = '[]'</c> on foods whose portions all have an <c>origin</c>.
/// </summary>
public sealed class UsdaPortionEnricher(NutriPlanDbContext db, ILogger<UsdaPortionEnricher> logger)
{
    private static readonly CsvConfiguration Csv = new(CultureInfo.InvariantCulture) { HasHeaderRecord = true, MissingFieldFound = null, BadDataFound = null };

    /// <param name="folders">Extracted USDA download folders; the Foundation one (foundation_food.csv) and the SR Legacy one
    /// (sr_legacy_food.csv) are found among them.</param>
    public async Task<PortionEnrichmentResult> RunAsync(IEnumerable<string> folders, bool apply, CancellationToken ct = default)
    {
        var list = folders.ToList();
        var foundationCsv = list.Select(f => Path.Combine(f, "foundation_food.csv")).FirstOrDefault(File.Exists);
        var srCsv = list.Select(f => Path.Combine(f, "sr_legacy_food.csv")).FirstOrDefault(File.Exists);
        if (foundationCsv is null || srCsv is null)
            throw new FileNotFoundException("Need both the Foundation (foundation_food.csv) and SR Legacy (sr_legacy_food.csv) folders.");

        var foundationNdb = ReadNdb(foundationCsv);                                  // Foundation fdc_id → NDB
        var srByNdb = ReadNdb(srCsv).GroupBy(x => x.Value).Where(g => g.Count() == 1)  // NDB → SR fdc_id (only unambiguous)
            .ToDictionary(g => g.Key, g => g.Single().Key);

        var empty = await db.Foods.Where(f => f.Source == FoodSource.UsdaFoundation && f.SourceId != null).ToListAsync(ct);
        empty = empty.Where(f => f.Portions.Count == 0 && !f.IsVolume).ToList();
        var pairs = empty
            .Select(f => (Food: f, Ndb: long.TryParse(f.SourceId, out var id) ? foundationNdb.GetValueOrDefault(id) : null))
            .Where(x => x.Ndb is not null && srByNdb.ContainsKey(x.Ndb))
            .Select(x => (x.Food, Ndb: x.Ndb!, SrId: srByNdb[x.Ndb!].ToString(CultureInfo.InvariantCulture)))
            .ToList();
        var srIds = pairs.Select(p => p.SrId).ToHashSet();
        var donors = (await db.Foods.AsNoTracking().Where(f => f.Source == FoodSource.UsdaSrLegacy && f.SourceId != null && srIds.Contains(f.SourceId)).ToListAsync(ct))
            .GroupBy(f => f.SourceId!).ToDictionary(g => g.Key, g => g.First());

        var changes = new List<PortionEnrichment>();
        var rejected = new List<string>();
        foreach (var (food, ndb, srId) in pairs)
        {
            if (!donors.TryGetValue(srId, out var donor) || donor.Portions.Count == 0) continue;
            var origin = $"USDA SR Legacy “{donor.Name}” (FDC {srId}, same NDB {ndb})";
            var borrowed = EquivalentPortions.Borrowable(food.Name, donor.Name, donor.Portions, origin);
            if (borrowed.Count == 0)
            {
                rejected.Add(EquivalentPortions.SameFood(food.Name, donor.Name)
                    ? $"{food.Name}: none of {donor.Name}'s portions fits its form (NDB {ndb})"
                    : $"{food.Name}  ≠  {donor.Name}: not shown to be the same food (NDB {ndb})");
                continue;
            }
            changes.Add(new PortionEnrichment(food.Id, food.Name, donor.Name, long.Parse(srId, CultureInfo.InvariantCulture), ndb, borrowed));
            if (apply) food.ReplacePortions(borrowed);
        }
        if (apply && changes.Count > 0) await db.SaveChangesAsync(ct);
        logger.LogInformation("USDA portion enrichment: {Changed} of {Candidates} linked Foundation foods {Verb}", changes.Count, pairs.Count, apply ? "updated" : "would be updated");
        return new PortionEnrichmentResult(pairs.Count, changes, rejected, apply);
    }

    private static Dictionary<long, string> ReadNdb(string path)
    {
        using var reader = new CsvReader(new StreamReader(path), Csv);
        var map = new Dictionary<long, string>();
        foreach (var r in reader.GetRecords<NdbRow>())
            if (!string.IsNullOrWhiteSpace(r.NDB_number)) map[r.fdc_id] = r.NDB_number.Trim();
        return map;
    }

#pragma warning disable IDE1006
    private sealed class NdbRow { public long fdc_id { get; set; } public string? NDB_number { get; set; } }
#pragma warning restore IDE1006
}
