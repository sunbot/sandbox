using NutriPlan.Application.Abstractions;
using NutriPlan.Domain.Planning;

namespace NutriPlan.Application.Planning;

/// <summary>
/// The one place plan entries are read for display and totals. A plan entry marked Eaten must have a diary entry behind
/// it; if not (the log was deleted, or older data), it reads as Planned again so every screen agrees with the diary.
/// The correction is made in memory here and saved the next time that entry is saved; reading never writes.
/// </summary>
public static class PlanReconciliation
{
    public static async Task<IReadOnlyList<PlanEntry>> ReadRangeAsync(IPlanRepository plan, IDiaryRepository diary, DateOnly from, DateOnly to, CancellationToken ct)
    {
        var entries = await plan.GetRangeAsync(from, to, ct);
        await ReconcileAsync(entries, diary, ct);
        return entries;
    }

    public static async Task<PlanEntry?> ReadAsync(IPlanRepository plan, IDiaryRepository diary, Guid id, CancellationToken ct)
    {
        var entry = await plan.GetAsync(id, ct);
        if (entry is not null) await ReconcileAsync([entry], diary, ct);
        return entry;
    }

    public static async Task ReconcileAsync(IEnumerable<PlanEntry> entries, IDiaryRepository diary, CancellationToken ct)
    {
        var eaten = entries.Where(e => e.Status == PlanStatus.Eaten).ToList();
        if (eaten.Count == 0) return;
        var linked = await diary.GetLinkedPlanEntryIdsAsync(eaten.Select(e => e.Id).ToList(), ct);
        foreach (var e in eaten) e.ReconcileEaten(linked.Contains(e.Id));
    }
}
