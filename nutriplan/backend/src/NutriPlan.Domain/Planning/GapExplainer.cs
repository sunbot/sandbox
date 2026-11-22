using System.Globalization;
using NutriPlan.Domain.Nutrients;

namespace NutriPlan.Domain.Planning;

/// <summary>
/// Plain-language reasons for a suggestion. Every sentence is built from the calculated amounts and only for nutrients
/// the suggestion really contributes to, so no claim goes beyond the numbers.
/// </summary>
public static class GapExplainer
{
    public static string Fmt(double v) => Math.Abs(v) >= 10 ? Math.Round(v).ToString("0", CultureInfo.InvariantCulture) : Math.Round(v, 1).ToString("0.#", CultureInfo.InvariantCulture);

    private static string NameOf(int id) => NutrientCatalog.Get(id).Name.ToLowerInvariant();
    private static string UnitOf(int id) => NutrientCatalog.Get(id).Unit;

    public static IReadOnlyList<GapReason> Reasons(IReadOnlyList<GapSuggestionItem> items, NutrientProfile added, IReadOnlyList<GapTarget> needs, GapFillPolicy p, double scale = 1)
    {
        var reasons = new List<GapReason>();

        // Goals the suggestion really helps, biggest contribution first.
        var helped = needs
            .Where(n => n.Kind == TargetKind.Goal && n.Evaluable && n.NutrientId != NutrientIds.Energy && n.Weight > 0 && n.DailyTarget > 0 && n.Remaining > p.OpenNeedShare * n.DailyTarget)
            .Select(n => (Need: n, Amount: added.Get(n.NutrientId), Share: Math.Min(added.Get(n.NutrientId), n.Remaining * scale) / (n.Remaining * scale)))
            .Where(x => x.Share >= p.ReasonMinShare)
            .OrderByDescending(x => x.Need.Weight * x.Share)
            .Take(3);
        foreach (var (need, amount, share) in helped)
        {
            var id = need.NutrientId;
            var unit = UnitOf(id);
            if (id == NutrientIds.Protein)
                reasons.Add(new("protein", $"Adds about {Fmt(amount)} {unit} protein ({Fmt(need.Remaining)} {unit} still needed)", id));
            else if (id == NutrientIds.Fiber)
                reasons.Add(new("gap", $"Helps close your fiber gap: about {Fmt(amount)} of the {Fmt(need.Remaining)} {unit} missing", id));
            else if (amount / need.DailyTarget >= p.UsefulSourceShare)
                reasons.Add(new("source", $"A useful source of {NameOf(id)}: about {Fmt(amount / need.DailyTarget * 100)}% of your daily target", id));
            else
                reasons.Add(new("gap", $"Helps close your {NameOf(id)} gap: about {Fmt(amount)} of the {Fmt(need.Remaining)} {unit} missing", id));
        }

        // Limits it uses a noticeable part of (only said when true).
        foreach (var l in needs.Where(n => n.Kind == TargetKind.Limit && n.NutrientId != NutrientIds.Energy && n.Remaining > 0 && n.DailyTarget > 0))
        {
            var amount = added.Get(l.NutrientId);
            if (amount > 0 && amount / l.Remaining >= 0.25)
                reasons.Add(new("limit", $"Uses {Fmt(amount)} of the {Fmt(l.Remaining)} {UnitOf(l.NutrientId)} {NameOf(l.NutrientId)} left in your limit", l.NutrientId));
        }

        var energy = needs.FirstOrDefault(n => n.NutrientId == NutrientIds.Energy);
        if (energy is { Remaining: > 0 })
            reasons.Add(new("calories", $"Fits within your remaining {Fmt(energy.Remaining)} kcal (leaves about {Fmt(Math.Max(0, energy.Remaining - added.Calories))})"));

        var origin = items.Aggregate(GapOrigin.None, (o, i) => o | i.Candidate.Origin);
        if (origin.HasFlag(GapOrigin.Favorite)) reasons.Add(new("favorite", "One of your favorite recipes"));
        else if (origin.HasFlag(GapOrigin.SavedRecipe) && items.Any(i => i.Candidate.IsRecipe)) reasons.Add(new("recipe", "A recipe you've saved"));
        if (origin.HasFlag(GapOrigin.Pantry)) reasons.Add(new("pantry", "Uses food from your pantry"));
        if (origin.HasFlag(GapOrigin.Frequent)) reasons.Add(new("frequent", "You eat this often"));
        return reasons;
    }

    /// <summary>For each goal it helps (and limit it touches): how much is still missing / how much room is left, before and after.</summary>
    public static IReadOnlyList<GapEffect> Effects(NutrientProfile added, IReadOnlyList<GapTarget> needs, GapFillPolicy p)
    {
        var effects = new List<GapEffect>();
        foreach (var n in needs.Where(n => n.NutrientId != NutrientIds.Energy && n.DailyTarget > 0))
        {
            var amount = added.Get(n.NutrientId);
            if (amount <= 0) continue;
            if (n.Kind == TargetKind.Goal)
            {
                if (!n.Evaluable || n.Remaining <= p.OpenNeedShare * n.DailyTarget || amount / n.Remaining < 0.05) continue;
                effects.Add(new(n.NutrientId, Math.Max(0, n.Remaining), Math.Max(0, n.Remaining - amount), TargetKind.Goal));
            }
            else if (n.Remaining > 0 && amount / n.DailyTarget >= 0.03)
            {
                effects.Add(new(n.NutrientId, n.Remaining, n.Remaining - amount, TargetKind.Limit));
            }
        }
        return effects.OrderByDescending(e => e.Kind == TargetKind.Goal ? needs.First(n => n.NutrientId == e.NutrientId).Weight : 0).Take(5).ToList();
    }

    public static IReadOnlyList<GapReason> SwapReasons(NutrientProfile from, NutrientProfile to, IReadOnlyList<GapTarget> needs, GapFillPolicy p)
    {
        var reasons = new List<GapReason> { new("saves", $"Saves about {Fmt(from.Calories - to.Calories)} kcal") };
        foreach (var n in needs.Where(n => n.Kind == TargetKind.Goal && n.Evaluable && n.NutrientId != NutrientIds.Energy && n.Weight > 0 && n.DailyTarget > 0 && n.Remaining > p.OpenNeedShare * n.DailyTarget)
                     .OrderByDescending(n => n.Weight * n.Remaining / n.DailyTarget).Take(2))
        {
            var a = from.Get(n.NutrientId);
            var b = to.Get(n.NutrientId);
            var id = n.NutrientId;
            if (b - a >= 0.1 * n.DailyTarget || (b > a && b - a >= 1))
                reasons.Add(new("more", $"Adds about {Fmt(b - a)} {UnitOf(id)} more {NameOf(id)}", id));
            else if (a > 0 && b >= 0.9 * a)
                reasons.Add(new("same", $"Keeps about the same {NameOf(id)} ({Fmt(b)} vs {Fmt(a)} {UnitOf(id)})", id));
        }
        return reasons;
    }
}
