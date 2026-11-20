using NutriPlan.Domain.Diary;
using NutriPlan.Domain.Nutrients;

namespace NutriPlan.Domain.Planning;

/// <summary>
/// Something the gap filler may suggest. <see cref="NutrientsPerStep"/> is the nutrition of one step
/// (e.g. 25 g of yogurt, or half a recipe serving); quantities are whole multiples of a step.
/// </summary>
public sealed record GapCandidate(
    string Key,
    ItemKind Kind,
    Guid? FoodId,
    Guid? RecipeId,
    string Name,
    NutrientProfile NutrientsPerStep,
    double StepAmount,
    string StepUnit,
    int MinSteps,
    int MaxSteps,
    double PreferenceBonus = 0);

public sealed record GapSuggestionItem(GapCandidate Candidate, int Steps)
{
    public double Amount => Steps * Candidate.StepAmount;
    public NutrientProfile Nutrients => Candidate.NutrientsPerStep.Scale(Steps);
}

public sealed record GapSuggestion(
    IReadOnlyList<GapSuggestionItem> Items,
    NutrientProfile Added,
    NutrientProfile RemainingAfter,
    double Score);

/// <summary>A nutrient to aim for, how much is still needed, and how much it matters.</summary>
public sealed record GapTarget(int NutrientId, double Remaining, double DailyTarget, TargetKind Kind, double Weight);

public sealed record GapFillOptions(int MaxItems = 3, int Suggestions = 3, int BeamWidth = 30);

/// <summary>
/// Picks up to N foods/recipes with whole-step quantities that minimise the weighted squared
/// distance between what's still needed and what they add. It's a small integer program; a
/// beam search with per-item quantity tuning is exact enough at this scale, has no native deps,
/// and is easy to read. Swap in OR-Tools behind the same inputs if you ever need more.
///
/// Scoring rules:
///  • Calories: overshooting costs 3× more than undershooting the same amount.
///  • Goal nutrients (protein, fiber, vitamins…): only shortfall costs; extra is free.
///  • Limit nutrients (sodium, sat fat, added sugar): only exceeding the remaining allowance costs.
/// </summary>
public static class GapFiller
{
    public const double CalorieOvershootPenalty = 3.0;

    public static IReadOnlyList<GapSuggestion> Suggest(
        IReadOnlyList<GapTarget> targets,
        IReadOnlyList<GapCandidate> candidates,
        GapFillOptions? options = null)
    {
        options ??= new GapFillOptions();
        if (targets.Count == 0 || candidates.Count == 0) return [];

        // Nothing meaningful left to fill (within 3 % of calories and every goal met)?
        var energy = targets.FirstOrDefault(t => t.NutrientId == NutrientIds.Energy);
        if (energy is not null && energy.Remaining <= energy.DailyTarget * 0.03 &&
            targets.Where(t => t.Kind == TargetKind.Goal && t.NutrientId != NutrientIds.Energy).All(t => t.Remaining <= 0))
            return [];

        var baseline = Score(targets, NutrientProfile.Empty);

        // 1) Best quantity for every single candidate.
        var singles = candidates
            .Select(c => Tune([new GapSuggestionItem(c, Math.Max(1, c.MinSteps))], 0, targets))
            .Where(s => s.Score < baseline)
            .OrderBy(s => s.Score)
            .Take(options.BeamWidth)
            .ToList();

        var beam = singles;
        var all = new List<GapSuggestion>(singles);
        var pool = singles.Select(s => s.Items[0].Candidate).ToList();

        // 2) Grow combinations one item at a time, re-tuning every quantity after each addition.
        for (var size = 2; size <= options.MaxItems; size++)
        {
            var next = new List<GapSuggestion>();
            foreach (var combo in beam)
            {
                foreach (var candidate in pool)
                {
                    if (combo.Items.Any(i => i.Candidate.Key == candidate.Key)) continue;
                    var items = combo.Items.Append(new GapSuggestionItem(candidate, Math.Max(1, candidate.MinSteps))).ToList();
                    var tuned = TuneAll(items, targets);
                    if (tuned.Score < combo.Score * 0.97) next.Add(tuned); // must actually help
                }
            }
            beam = Dedupe(next).OrderBy(s => s.Score).Take(options.BeamWidth).ToList();
            all.AddRange(beam);
            if (beam.Count == 0) break;
        }

        // 3) Return the best few *distinct* suggestions (no two share the same lead item).
        var result = new List<GapSuggestion>();
        foreach (var s in Dedupe(all).OrderBy(s => s.Score))
        {
            if (result.Any(r => Overlap(r, s) >= Math.Min(r.Items.Count, s.Items.Count))) continue;
            result.Add(s);
            if (result.Count == options.Suggestions) break;
        }
        return result;
    }

    /// <summary>Weighted squared shortfall/overshoot, each nutrient normalised by its daily target.</summary>
    public static double Score(IReadOnlyList<GapTarget> targets, NutrientProfile added)
    {
        double score = 0;
        foreach (var t in targets)
        {
            var scale = Math.Max(t.DailyTarget, 1e-6);
            var diff = (t.Remaining - added.Get(t.NutrientId)) / scale; // + = still short, − = over
            double cost;
            if (t.NutrientId == NutrientIds.Energy)
                cost = diff >= 0 ? diff * diff : CalorieOvershootPenalty * diff * diff;
            else if (t.Kind == TargetKind.Goal)
                cost = diff > 0 ? diff * diff : 0;
            else
                cost = diff < 0 ? diff * diff : 0; // limit: remaining allowance exceeded
            score += t.Weight * cost;
        }
        return score;
    }

    private static GapSuggestion TuneAll(List<GapSuggestionItem> items, IReadOnlyList<GapTarget> targets)
    {
        GapSuggestion current = Build(items, targets);
        for (var pass = 0; pass < 3; pass++)
        {
            var before = current.Score;
            for (var i = 0; i < current.Items.Count; i++)
                current = Tune(current.Items, i, targets);
            if (before - current.Score < 1e-9) break;
        }
        return current;
    }

    /// <summary>Tries every step count for item <paramref name="index"/> holding the others fixed.</summary>
    private static GapSuggestion Tune(IReadOnlyList<GapSuggestionItem> items, int index, IReadOnlyList<GapTarget> targets)
    {
        var candidate = items[index].Candidate;
        GapSuggestion? best = null;
        for (var steps = Math.Max(1, candidate.MinSteps); steps <= candidate.MaxSteps; steps++)
        {
            var trial = items.ToList();
            trial[index] = new GapSuggestionItem(candidate, steps);
            var s = Build(trial, targets);
            if (best is null || s.Score < best.Score) best = s;
        }
        return best!;
    }

    private static GapSuggestion Build(IReadOnlyList<GapSuggestionItem> items, IReadOnlyList<GapTarget> targets)
    {
        var added = NutrientProfile.Sum(items.Select(i => i.Nutrients));
        var remaining = new NutrientProfile(targets.ToDictionary(t => t.NutrientId, t => t.Remaining - added.Get(t.NutrientId)));
        var bonus = items.Sum(i => i.Candidate.PreferenceBonus);
        var score = Score(targets, added) * (1 - Math.Clamp(bonus, 0, 0.3)) + items.Count * 0.002; // slight preference for fewer items
        return new GapSuggestion(items.ToList(), added.Rounded(), remaining.Rounded(), score);
    }

    private static IEnumerable<GapSuggestion> Dedupe(IEnumerable<GapSuggestion> suggestions) =>
        suggestions
            .GroupBy(s => string.Join('|', s.Items.Select(i => i.Candidate.Key).Order()))
            .Select(g => g.OrderBy(s => s.Score).First());

    private static int Overlap(GapSuggestion a, GapSuggestion b) =>
        a.Items.Select(i => i.Candidate.Key).Intersect(b.Items.Select(i => i.Candidate.Key)).Count();
}
