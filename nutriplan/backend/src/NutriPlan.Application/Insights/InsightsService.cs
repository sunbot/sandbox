using NutriPlan.Application.Abstractions;
using NutriPlan.Domain.Nutrients;
using NutriPlan.Domain.Planning;

namespace NutriPlan.Application.Insights;

/// <param name="MissingFrom">Entries that day with no value for this nutrient (unknown, not zero): the amount is then a minimum.</param>
public sealed record HeatmapCellDto(DateOnly Date, double Amount, double? Percent, string Level, int MissingFrom = 0);

/// <param name="WeeklyAveragePercent">Average % of target over <b>finished</b> logged days (before today); 0 when there are none.</param>
/// <param name="AverageAmount">Average daily amount over the same finished logged days; null when there are none.</param>
/// <param name="CompletedDays">Finished days with something logged: the days the averages cover.</param>
/// <param name="IncompleteDays">Of those, days where some entries had no value for this nutrient (averages are then minimums).</param>
public sealed record HeatmapRowDto(int NutrientId, string Name, string Unit, string Kind, double Target, double WeeklyAveragePercent, IReadOnlyList<HeatmapCellDto> Days,
    double? AverageAmount = null, int CompletedDays = 0, int IncompleteDays = 0);

public sealed record HeatmapDto(DateOnly From, DateOnly To, IReadOnlyList<HeatmapRowDto> Rows, IReadOnlyList<string> Highlights);

/// <summary>
/// The weekly nutrient heatmap: one row per nutrient, one cell per day, coloured by % of target.
/// For goals: low (&lt;50 %), fair (50–90 %), good (90 %+). For limits: good (≤100 %), high (&gt;100 %).
/// Days with nothing logged are "none" and don't drag the average down.
/// </summary>
public sealed class InsightsService(IDiaryRepository diary, ITargetsRepository targetsRepo, IClock clock)
{
    /// <summary>
    /// Today is still under way, so it never feeds an average or a "consistently low" note. "Today" is the caller's date
    /// when given (the app sends its own), otherwise the server's.
    /// </summary>
    public const int MinDaysForPatterns = 3;

    /// <summary>Targets where going well past is worth noting (carbs, fat): over 110% reads "over target", not "goal met".</summary>
    public static readonly HashSet<int> OverTargetMatters = [NutrientIds.Carbohydrate, NutrientIds.Fat];

    public async Task<HeatmapDto> GetHeatmapAsync(DateOnly? weekContaining, DateOnly? clientToday = null, CancellationToken ct = default)
    {
        var today = clientToday ?? clock.Today;
        var targets = await targetsRepo.GetAsync(ct);
        var start = WeeklyBudgetCalculator.WeekStartFor(weekContaining ?? today, targets.WeekStartsOn);
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
                var missing = entries.Count(e => e.Date == kv.Key && !e.Item.Nutrients.Has(id));
                return new HeatmapCellDto(kv.Key, Math.Round(amount, 2), Math.Round(pct, 1), Level(pct, kind, id), missing);
            }).ToList();

            var finished = cells.Where(c => c.Percent is not null && c.Date < today).ToList();
            var avg = finished.Count == 0 ? 0 : finished.Average(c => c.Percent!.Value);
            double? avgAmount = finished.Count == 0 ? null : Math.Round(finished.Average(c => c.Amount), 2);
            rows.Add(new HeatmapRowDto(id, def.Name, def.Unit, kind.ToString(), target, Math.Round(avg, 1), cells,
                avgAmount, finished.Count, finished.Count(c => c.MissingFrom > 0)));
        }

        return new HeatmapDto(start, end, rows, Highlights(rows, loggedDays.Count, loggedDays.Count(d => d < today)));
    }

    public static string Level(double percent, TargetKind kind, int nutrientId)
    {
        if (kind == TargetKind.Limit) return percent <= 100 ? "good" : percent <= 130 ? "high" : "veryHigh";
        if (nutrientId == NutrientIds.Energy) return percent < 85 ? "low" : percent <= 110 ? "good" : "high";
        if (OverTargetMatters.Contains(nutrientId) && percent > 110) return "high";
        return percent < 50 ? "low" : percent < 90 ? "fair" : "good";
    }

    /// <summary>
    /// Plain notes about the finished days of the week. Patterns need at least <see cref="MinDaysForPatterns"/> finished
    /// logged days; a nutrient with missing data on any of them is never called low (its total is only a minimum).
    /// </summary>
    public static IReadOnlyList<string> Highlights(IReadOnlyList<HeatmapRowDto> rows, int loggedDays, int finishedDays)
    {
        if (loggedDays == 0) return ["Nothing logged this week yet."];
        if (finishedDays < MinDaysForPatterns)
            return [finishedDays == 0
                ? "Only today is logged so far. Weekly patterns appear after a few finished days."
                : $"{finishedDays} finished {(finishedDays == 1 ? "day" : "days")} logged. Weekly patterns appear after {MinDaysForPatterns}."];
        var notes = new List<string>();
        var shortfalls = rows.Where(r => r.Kind == nameof(TargetKind.Goal) && r.NutrientId != NutrientIds.Energy && r.CompletedDays >= MinDaysForPatterns
                && r.IncompleteDays == 0 && r.WeeklyAveragePercent < 70)
            .OrderBy(r => r.WeeklyAveragePercent).Take(3).ToList();
        if (shortfalls.Count > 0)
            notes.Add($"Below goal on average over {finishedDays} finished days: " + string.Join(", ", shortfalls.Select(r => $"{r.Name} ({r.WeeklyAveragePercent:0}%)")));
        var overs = rows.Where(r => r.Kind == nameof(TargetKind.Limit) && r.CompletedDays > 0 && r.WeeklyAveragePercent > 100).ToList();
        if (overs.Count > 0)
            notes.Add("Over the limit on average: " + string.Join(", ", overs.Select(r => $"{r.Name} ({r.WeeklyAveragePercent:0}%)")));
        var overTarget = rows.Where(r => OverTargetMatters.Contains(r.NutrientId) && r.CompletedDays > 0 && r.WeeklyAveragePercent > 110).ToList();
        if (overTarget.Count > 0)
            notes.Add("Over target on average: " + string.Join(", ", overTarget.Select(r => $"{r.Name} ({r.WeeklyAveragePercent:0}%)")));
        var wins = rows.Where(r => r.Kind == nameof(TargetKind.Goal) && r.NutrientId != NutrientIds.Energy && r.CompletedDays > 0 && r.WeeklyAveragePercent >= 100
                && !(OverTargetMatters.Contains(r.NutrientId) && r.WeeklyAveragePercent > 110)).Select(r => r.Name).Take(4).ToList();
        if (wins.Count > 0) notes.Add("Goal met on average: " + string.Join(", ", wins));
        return notes;
    }
}
