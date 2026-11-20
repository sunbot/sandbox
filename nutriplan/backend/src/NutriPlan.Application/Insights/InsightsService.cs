using NutriPlan.Application.Abstractions;
using NutriPlan.Domain.Nutrients;
using NutriPlan.Domain.Planning;

namespace NutriPlan.Application.Insights;

public sealed record HeatmapCellDto(DateOnly Date, double Amount, double? Percent, string Level);

public sealed record HeatmapRowDto(int NutrientId, string Name, string Unit, string Kind, double Target, double WeeklyAveragePercent, IReadOnlyList<HeatmapCellDto> Days);

public sealed record HeatmapDto(DateOnly From, DateOnly To, IReadOnlyList<HeatmapRowDto> Rows, IReadOnlyList<string> Highlights);

/// <summary>
/// The weekly nutrient heatmap: one row per nutrient, one cell per day, coloured by % of target.
/// For goals: low (&lt;50 %), fair (50–90 %), good (90 %+). For limits: good (≤100 %), high (&gt;100 %).
/// Days with nothing logged are "none" and don't drag the average down.
/// </summary>
public sealed class InsightsService(IDiaryRepository diary, ITargetsRepository targetsRepo, IClock clock)
{
    public async Task<HeatmapDto> GetHeatmapAsync(DateOnly? weekContaining, CancellationToken ct = default)
    {
        var targets = await targetsRepo.GetAsync(ct);
        var start = WeeklyBudgetCalculator.WeekStartFor(weekContaining ?? clock.Today, targets.WeekStartsOn);
        var end = start.AddDays(6);
        var entries = await diary.GetRangeAsync(start, end, ct);

        var totals = Enumerable.Range(0, 7).Select(i => start.AddDays(i)).ToDictionary(
            d => d,
            d => NutrientProfile.Sum(entries.Where(e => e.Date == d).Select(e => e.Item.Nutrients)));
        var loggedDays = totals.Where(kv => kv.Value.Calories > 0).Select(kv => kv.Key).ToHashSet();

        var ids = new[] { NutrientIds.Energy, NutrientIds.Protein, NutrientIds.Carbohydrate, NutrientIds.Fat }
            .Concat(targets.EffectiveFocusNutrients).Distinct();

        var rows = new List<HeatmapRowDto>();
        foreach (var id in ids)
        {
            if (targets.TargetFor(id) is not { } target || target <= 0) continue;
            var def = NutrientCatalog.Get(id);
            var kind = targets.KindFor(id);
            var cells = totals.OrderBy(kv => kv.Key).Select(kv =>
            {
                if (!loggedDays.Contains(kv.Key)) return new HeatmapCellDto(kv.Key, 0, null, "none");
                var amount = kv.Value.Get(id);
                var pct = amount / target * 100;
                return new HeatmapCellDto(kv.Key, Math.Round(amount, 2), Math.Round(pct, 1), Level(pct, kind, id));
            }).ToList();

            var logged = cells.Where(c => c.Percent is not null).ToList();
            var avg = logged.Count == 0 ? 0 : logged.Average(c => c.Percent!.Value);
            rows.Add(new HeatmapRowDto(id, def.Name, def.Unit, kind.ToString(), target, Math.Round(avg, 1), cells));
        }

        return new HeatmapDto(start, end, rows, Highlights(rows, loggedDays.Count));
    }

    public static string Level(double percent, TargetKind kind, int nutrientId)
    {
        if (kind == TargetKind.Limit) return percent <= 100 ? "good" : percent <= 130 ? "high" : "veryHigh";
        if (nutrientId == NutrientIds.Energy) return percent < 85 ? "low" : percent <= 110 ? "good" : "high";
        return percent < 50 ? "low" : percent < 90 ? "fair" : "good";
    }

    private static IReadOnlyList<string> Highlights(IReadOnlyList<HeatmapRowDto> rows, int loggedDays)
    {
        if (loggedDays == 0) return ["Nothing logged this week yet."];
        var notes = new List<string>();
        var shortfalls = rows.Where(r => r.Kind == nameof(TargetKind.Goal) && r.NutrientId != NutrientIds.Energy && r.WeeklyAveragePercent < 70)
            .OrderBy(r => r.WeeklyAveragePercent).Take(3).ToList();
        if (shortfalls.Count > 0)
            notes.Add("Consistently low: " + string.Join(", ", shortfalls.Select(r => $"{r.Name} ({r.WeeklyAveragePercent:0}%)")));
        var overs = rows.Where(r => r.Kind == nameof(TargetKind.Limit) && r.WeeklyAveragePercent > 100).ToList();
        if (overs.Count > 0)
            notes.Add("Over the limit on average: " + string.Join(", ", overs.Select(r => $"{r.Name} ({r.WeeklyAveragePercent:0}%)")));
        var wins = rows.Where(r => r.Kind == nameof(TargetKind.Goal) && r.NutrientId != NutrientIds.Energy && r.WeeklyAveragePercent >= 100).Select(r => r.Name).Take(4).ToList();
        if (wins.Count > 0) notes.Add("On track: " + string.Join(", ", wins));
        return notes;
    }
}
