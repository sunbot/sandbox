using NutriPlan.Domain.Diary;
using NutriPlan.Domain.Nutrients;

namespace NutriPlan.Domain.Planning;

public sealed record GapModeAvailability(GapMode Mode, int Count);

/// <summary>
/// Context-aware, deterministic recommendations for what's left of the day.
///
/// The day is first classified (<see cref="GapSituation"/>): with room for a meal or a snack, suggestions are built from
/// real portions of saved recipes, pantry foods, foods you eat and a few staples, assembled into coherent meals
/// (a main + sides) or snacks (compatible pairs), and kept only when they pass hard constraints:
/// they fit the calories left, never push an exceeded limit further, and every item covers a meaningful share of
/// something still missing. When you are at or over your calorie target nothing is added: swaps for planned meals and
/// ideas for tomorrow are offered instead. There is no global optimizer to exploit tiny amounts.
/// </summary>
public static class GapRecommender
{
    public static GapSituation Classify(double kcalRemaining, double dailyKcal, GapFillPolicy p)
    {
        if (kcalRemaining < -p.OverTolerancePct * dailyKcal) return GapSituation.Over;
        if (kcalRemaining < p.MinSnackKcal) return GapSituation.AtTarget;
        if (kcalRemaining < p.MinMealKcal) return GapSituation.Near;
        return GapSituation.Open;
    }

    public static GapSituation Classify(IReadOnlyList<GapTarget> needs, GapFillPolicy p) =>
        needs.FirstOrDefault(n => n.NutrientId == NutrientIds.Energy) is { } e ? Classify(e.Remaining, e.DailyTarget, p) : GapSituation.AtTarget;

    /// <summary>Goals that are still meaningfully short and whose data can be trusted.</summary>
    public static IReadOnlyList<GapTarget> OpenNeeds(IReadOnlyList<GapTarget> needs, GapFillPolicy p) =>
        needs.Where(n => n.Kind == TargetKind.Goal && n.Evaluable && n.NutrientId != NutrientIds.Energy && n.Weight > 0 && n.DailyTarget > 0 && n.Remaining > p.OpenNeedShare * n.DailyTarget).ToList();

    // ── Suggestions ────────────────────────────────────────────────────────────────────────────────

    public static IReadOnlyList<GapSuggestion> Suggest(IReadOnlyList<GapTarget> needs, IReadOnlyList<GapCandidate> pool, GapMode mode, GapContext ctx, GapFillPolicy p) =>
        SuggestPage(needs, pool, mode, ctx, p).Items;

    /// <summary>
    /// The best few ideas not yet shown (<see cref="GapContext.Exclude"/>). Every qualifying idea is built and checked exactly
    /// as before; shown ones are skipped, and ideas led by a food or recipe that led a shown one come after fresh ones, so
    /// each page is genuinely different. Deterministic: the same inputs give the same page.
    /// </summary>
    public static GapPage SuggestPage(IReadOnlyList<GapTarget> needs, IReadOnlyList<GapCandidate> pool, GapMode mode, GapContext ctx, GapFillPolicy p)
    {
        var all = Qualifying(needs, pool, mode, ctx, p);
        var exclude = ctx.Exclude ?? new HashSet<string>();
        var shownAnchors = all.Where(s => exclude.Contains(IdOf(s))).Select(Anchor).ToHashSet(StringComparer.Ordinal);
        var unseen = all.Where(s => !exclude.Contains(IdOf(s))).ToList();
        var result = new List<GapSuggestion>();
        var anchors = new HashSet<string>();
        foreach (var s in unseen.OrderBy(s => shownAnchors.Contains(Anchor(s)) ? 1 : 0)) // stable: keeps the score order within each group
        {
            if (!anchors.Add(Anchor(s))) continue;
            result.Add(s);
            if (result.Count == p.MaxSuggestions) break;
        }
        return new GapPage(result, unseen.Count - result.Count, all.Count - unseen.Count);
    }

    /// <summary>A suggestion's identity: its foods and recipes, whatever their order or amounts (short and stable, for the app to send back).</summary>
    public static string IdOf(GapSuggestion s) => IdOf(s.Items.Select(i => i.Candidate.Key));

    public static string IdOf(IEnumerable<string> keys)
    {
        var text = string.Join('+', keys.Distinct().Order(StringComparer.Ordinal));
        var hash = System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(text));
        return Convert.ToHexString(hash, 0, 8).ToLowerInvariant();
    }

    /// <summary>Every qualifying idea (best amount per combination of foods), best first.</summary>
    private static List<GapSuggestion> Qualifying(IReadOnlyList<GapTarget> needs, IReadOnlyList<GapCandidate> pool, GapMode mode, GapContext ctx, GapFillPolicy p)
    {
        var energy = needs.FirstOrDefault(n => n.NutrientId == NutrientIds.Energy);
        if (energy is null) return [];
        var situation = Classify(energy.Remaining, energy.DailyTarget, p);
        if (situation is GapSituation.Over or GapSituation.AtTarget) return [];
        var open = OpenNeeds(needs, p);
        if (open.Count == 0) return [];

        var kcalLeft = energy.Remaining;
        var limits = needs.Where(n => n.Kind == TargetKind.Limit && n.NutrientId != NutrientIds.Energy && n.DailyTarget > 0).ToList();
        var eligible = pool.Where(c => c.Role != GapRole.Ingredient && Multiples(c, p).Any() && ctx.OnToday?.Contains(c.Key) != true // not what's already on today
                                       && mode switch { GapMode.Pantry => c.Origin.HasFlag(GapOrigin.Pantry), GapMode.SavedRecipes => c.IsRecipe, _ => true }).ToList();

        var found = new List<GapSuggestion>();
        void Try(List<GapSuggestionItem> items, GapCategory category)
        {
            if (Evaluate(items, category, kcalLeft, open, limits, needs, ctx, p) is { } s) found.Add(s);
        }

        // Single items: a recipe serving, a snack food, a side.
        foreach (var c in eligible)
        {
            // A side food (oatmeal, carrots, rice) is part of a meal, never a suggestion by itself; a saved side-dish recipe is fine.
            if (c.Role == GapRole.Side && !c.IsRecipe) continue;
            if (CategoryOf(c.Role) is not { } category || !Allowed(mode, category)) continue;
            foreach (var m in Multiples(c, p)) Try([new(c, m)], category);
        }

        // Snack pairs: compatible groups (yogurt + fruit) or a pair you've eaten together before.
        if (Allowed(mode, GapCategory.Snack))
        {
            var snacks = Top(eligible.Where(c => c.Role == GapRole.Snack), open, p);
            for (var i = 0; i < snacks.Count; i++)
                for (var j = i + 1; j < snacks.Count; j++)
                {
                    if (!(GapRoles.Compatible(snacks[i].Group, snacks[j].Group) || CoEaten(ctx, snacks[i], snacks[j]))) continue;
                    foreach (var ma in Multiples(snacks[i], p))
                        foreach (var mb in Multiples(snacks[j], p))
                            Try([new(snacks[i], ma), new(snacks[j], mb)], GapCategory.Snack);
                }
        }

        // Meals from parts: a main with a vegetable, grain or legume, or a vegetable plus a grain/legume.
        if (Allowed(mode, GapCategory.Meal) && kcalLeft >= p.MinMealKcal)
        {
            var mains = Top(eligible.Where(c => c.Role == GapRole.Main), open, p);
            var sides = Top(eligible.Where(c => c.Role == GapRole.Side && !c.IsRecipe && GapRoles.IsMealSide(c.Group)), open, p);
            foreach (var main in mains)
                for (var i = 0; i < sides.Count; i++)
                {
                    foreach (var mm in Multiples(main, p))
                        foreach (var ms in Multiples(sides[i], p))
                            Try([new(main, mm), new(sides[i], ms)], GapCategory.Meal);
                    for (var j = i + 1; j < sides.Count; j++)
                    {
                        if (!GapRoles.SidePair(sides[i].Group, sides[j].Group)) continue;
                        foreach (var mm in Multiples(main, p))
                            foreach (var m1 in Multiples(sides[i], p))
                                foreach (var m2 in Multiples(sides[j], p))
                                    Try([new(main, mm), new(sides[i], m1), new(sides[j], m2)], GapCategory.Meal);
                    }
                }
        }

        // Best quantity per combination (the same foods in any order are one idea), best first.
        return found.GroupBy(s => IdOf(s))
            .Select(g => g.OrderByDescending(s => s.Score).ThenBy(s => s.Added.Calories).First())
            .OrderByDescending(s => s.Score).ThenBy(s => string.Join('|', s.Items.Select(i => i.Candidate.Key)), StringComparer.Ordinal)
            .ToList();
    }

    /// <summary>Which modes have at least one suggestion right now (so the app only offers filters that lead somewhere).</summary>
    public static IReadOnlyList<GapModeAvailability> AvailableModes(IReadOnlyList<GapTarget> needs, IReadOnlyList<GapCandidate> pool, GapContext ctx, GapFillPolicy p)
    {
        var list = new List<GapModeAvailability>();
        foreach (var mode in Enum.GetValues<GapMode>())
        {
            var count = Suggest(needs, pool, mode, ctx with { Exclude = null }, p).Count;
            if (count > 0) list.Add(new(mode, count));
        }
        return list;
    }

    // ── Swaps and next-day ideas ───────────────────────────────────────────────────────────────────

    /// <summary>For planned, uneaten items on a day with little or no room: a lighter replacement of the same kind that doesn't lose what you're short on.</summary>
    public static IReadOnlyList<GapSwap> Swaps(IReadOnlyList<GapTarget> needs, IReadOnlyList<GapPlanned> planned, IReadOnlyList<GapCandidate> pool, GapFillPolicy p, IReadOnlySet<string>? onToday = null)
    {
        var open = OpenNeeds(needs, p);
        var limits = needs.Where(n => n.Kind == TargetKind.Limit && n.NutrientId != NutrientIds.Energy && n.DailyTarget > 0).ToList();
        var swaps = new List<GapSwap>();
        foreach (var from in planned.Where(x => x.Nutrients.Calories >= p.SwapMinSourceKcal))
        {
            var fromKcal = from.Nutrients.Calories;
            var major = open.OrderByDescending(n => n.Weight * Math.Min(1, n.Remaining / n.DailyTarget)).Take(Math.Max(1, p.ScoreNeedsConsidered)).ToList();
            GapSwap? best = null;
            double bestScore = double.NegativeInfinity;
            foreach (var c in pool.OrderBy(c => c.Key, StringComparer.Ordinal).Where(c => c.Role != GapRole.Ingredient && CategoryOf(c.Role) == from.Category && c.Key != from.Key && onToday?.Contains(c.Key) != true))
                foreach (var m in Multiples(c, p))
                {
                    var n = c.PerPortion.Scale(m);
                    var k = n.Calories;
                    if (k > fromKcal - p.SwapMinSavingsKcal || k < fromKcal * p.SwapMinKeepShare) continue;
                    // A swap may not trade away what you're short on: each major gap is covered about as well (within 10 %) or better.
                    if (!major.All(g => Math.Min(n.Get(g.NutrientId), g.Remaining) >= 0.9 * Math.Min(from.Nutrients.Get(g.NutrientId), g.Remaining) - 1e-9)) continue;
                    // A lighter swap must not add to a limit: where both amounts are known the new one is no higher, and an
                    // unknown value is skipped when the limit is nearly used up.
                    if (!limits.All(l => c.PerPortion.Has(l.NutrientId)
                            ? !from.Nutrients.Has(l.NutrientId) || n.Get(l.NutrientId) <= from.Nutrients.Get(l.NutrientId) + 1e-9
                            : !(l.Remaining <= p.NearLimitShare * l.DailyTarget))) continue;
                    var rank = NeedScore(n, open, p) * 10 + (fromKcal - k) / 1000 + Math.Min(1, c.Familiarity / 10.0) * 0.01;
                    if (rank <= bestScore) continue;
                    bestScore = rank;
                    var item = new GapSuggestionItem(c, m);
                    best = new GapSwap(from, item, Math.Round(fromKcal - k, 1), GapExplainer.SwapReasons(from.Nutrients, n, needs, p));
                }
            if (best is not null) swaps.Add(best);
        }
        var used = new HashSet<string>();
        return swaps.OrderByDescending(s => s.SavesKcal).Where(s => used.Add(s.To.Candidate.Key)).Take(p.MaxSwaps).ToList();
    }

    /// <summary>For the biggest goals that ran short: familiar foods that are real sources of each, to plan for another day.</summary>
    public static IReadOnlyList<GapTip> NextDay(IReadOnlyList<GapTarget> needs, IReadOnlyList<GapCandidate> pool, GapFillPolicy p)
    {
        var tips = new List<GapTip>();
        foreach (var n in OpenNeeds(needs, p).OrderByDescending(n => n.Weight * Math.Min(1, n.Remaining / n.DailyTarget)).Take(p.MaxTipNutrients))
        {
            var items = pool.OrderBy(c => c.Key, StringComparer.Ordinal).Where(c => c.Role != GapRole.Ingredient && Multiples(c, p).Contains(1.0) && c.PerPortion.Has(n.NutrientId) && c.PerPortion.Calories <= p.MaxMealKcal)
                .Select(c => new GapTipItem(c, c.PerPortion.Get(n.NutrientId), c.PerPortion.Get(n.NutrientId) / n.DailyTarget))
                .Where(t => t.DailyShare >= p.TipMinDailyShare)
                .OrderByDescending(t => Familiar(t.Candidate)).ThenByDescending(t => t.DailyShare).ThenBy(t => t.Candidate.Key, StringComparer.Ordinal)
                .Take(p.TipsPerNutrient).ToList();
            if (items.Count > 0) tips.Add(new GapTip(n.NutrientId, items));
        }
        return tips;
    }

    // ── Internals ──────────────────────────────────────────────────────────────────────────────────

    /// <summary>Allowed amounts: only multiples of a real portion, never tiny, never huge, never more than you have.</summary>
    public static IEnumerable<double> Multiples(GapCandidate c, GapFillPolicy p)
    {
        foreach (var m in c.Countable ? new[] { 1.0, 2.0 } : new[] { 0.5, 1.0, 1.5, 2.0 })
        {
            if (m < p.MinPortionFraction - 1e-9 || m > p.MaxPortionMultiple + 1e-9 || m > c.MaxMultiple + 1e-9) continue;
            if (!c.IsRecipe)
            {
                var amount = m * c.PortionAmount;
                if (amount < p.MinPortionGrams || amount > p.MaxPortionGrams) continue;
            }
            yield return m;
        }
    }

    private static GapCategory? CategoryOf(GapRole role) => role switch
    {
        GapRole.Meal => GapCategory.Meal,
        GapRole.Snack => GapCategory.Snack,
        GapRole.Side => GapCategory.Side,
        _ => null, // a main is only suggested with a side; ingredients never
    };

    private static bool Allowed(GapMode mode, GapCategory category) => mode switch
    {
        GapMode.Meal => category == GapCategory.Meal,
        GapMode.QuickSnack => category == GapCategory.Snack,
        _ => true,
    };

    private static (double Lo, double Hi) Window(GapCategory category, double kcalLeft, GapFillPolicy p)
    {
        var cap = kcalLeft * (1 + p.CalorieSlackPct);
        return category switch
        {
            GapCategory.Snack => (p.MinSnackKcal, Math.Min(cap, p.MaxSnackKcal)),
            GapCategory.Side => (p.MinSideKcal, Math.Min(cap, p.MaxSideKcal)),
            _ => (p.MinMealKcal, Math.Min(cap, p.MaxMealKcal)),
        };
    }

    private static GapSuggestion? Evaluate(List<GapSuggestionItem> items, GapCategory category, double kcalLeft, IReadOnlyList<GapTarget> open,
        IReadOnlyList<GapTarget> limits, IReadOnlyList<GapTarget> needs, GapContext ctx, GapFillPolicy p)
    {
        var added = NutrientProfile.Sum(items.Select(i => i.Nutrients));
        var (lo, hi) = Window(category, kcalLeft, p);
        if (added.Calories < lo - 1e-9 || added.Calories > hi + 1e-9) return null;

        // A suggestion of this size is expected to fill roughly its share of what's missing, so on a day with lots of room
        // (nothing eaten yet) a snack isn't judged against the whole day's protein.
        var scale = kcalLeft > 0 ? Math.Min(1, hi / kcalLeft) : 1;

        // Every item has to earn its place: no token amounts, no filler.
        if (items.Count > 1 && items.Any(i => i.Nutrients.Calories < p.MinItemKcal - 1e-9)) return null;
        if (!items.All(i => Contributes(i.Nutrients, open, p, scale))) return null;

        // Limits: never push one further past where it is, and don't guess when its value is unknown and it's nearly used up.
        foreach (var l in limits)
        {
            var add = added.Get(l.NutrientId);
            var near = l.Remaining <= p.NearLimitShare * l.DailyTarget;
            if (near && items.Any(i => !i.Candidate.PerPortion.Has(l.NutrientId))) return null;
            var allowance = l.Remaining > 0 ? l.Remaining : p.ExceededLimitTolerancePct * l.DailyTarget;
            if (add > allowance + 1e-9) return null;
        }

        // Gate on coverage of the share of the day's needs a suggestion this size should fill; rank on coverage of the
        // whole gap and on how much of the room it uses, so a meal isn't outranked by a snack just because snacks are small.
        if (NeedScore(added, open, p, scale) < p.MinSuggestionScore) return null;
        var room = Math.Max(1, Math.Min(kcalLeft, p.MaxMealKcal));
        var score = NeedScore(added, open, p) + p.CalorieFitWeight * Math.Clamp(added.Calories / room, 0, 1) + Preference(items, ctx, p) - p.ComplexityPenalty * (items.Count - 1)
            - p.ProteinPacingWeight * ProteinPacingShortfall(added, kcalLeft, open);

        var remaining = new NutrientProfile(needs.ToDictionary(n => n.NutrientId, n => n.Remaining - added.Get(n.NutrientId)));
        return new GapSuggestion(items.ToList(), category, added.Rounded(), remaining.Rounded(), score,
            GapExplainer.Reasons(items, added, needs, p, scale), GapExplainer.Effects(added, needs, p));
    }

    /// <summary>
    /// How much bigger the share of the calories left is than the share of the protein still needed (0 when protein isn't a
    /// gap or the suggestion keeps pace), times protein's priority. 828 kcal of 1,038 left with 11 of 115 g protein ≈ 0.7 × 0.9.
    /// </summary>
    public static double ProteinPacingShortfall(NutrientProfile added, double kcalLeft, IReadOnlyList<GapTarget> open)
    {
        var protein = open.FirstOrDefault(n => n.NutrientId == NutrientIds.Protein);
        if (protein is null || protein.Remaining <= 0 || protein.DailyTarget <= 0 || kcalLeft <= 0) return 0;
        var kcalShare = Math.Clamp(added.Calories / kcalLeft, 0, 1);
        var proteinShare = Math.Clamp(added.Protein / protein.Remaining, 0, 1);
        var priority = protein.Weight * Math.Min(1, protein.Remaining / protein.DailyTarget);
        return Math.Max(0, kcalShare - proteinShare) * priority;
    }

    private static bool Contributes(NutrientProfile item, IReadOnlyList<GapTarget> open, GapFillPolicy p, double scale = 1) =>
        open.Any(n => Math.Min(item.Get(n.NutrientId), n.Remaining * scale) / (n.Remaining * scale) >= p.MinContributionShare);

    /// <summary>How much of what's most missing this covers (each need capped at what's still needed, weighted by importance).</summary>
    public static double NeedScore(NutrientProfile added, IReadOnlyList<GapTarget> open, GapFillPolicy p, double scale = 1)
    {
        if (open.Count == 0) return 0;
        double Priority(GapTarget n) => n.Weight * Math.Min(1, n.Remaining / n.DailyTarget);
        var denominator = open.Select(Priority).OrderByDescending(x => x).Take(Math.Max(1, p.ScoreNeedsConsidered)).Sum();
        if (denominator <= 0) return 0;
        var numerator = open.Sum(n => Priority(n) * Math.Min(added.Get(n.NutrientId), n.Remaining * scale) / (n.Remaining * scale));
        return numerator / denominator;
    }

    private static double Preference(IReadOnlyList<GapSuggestionItem> items, GapContext ctx, GapFillPolicy p)
    {
        double One(GapCandidate c)
        {
            var b = 0.0;
            if (c.Origin.HasFlag(GapOrigin.Favorite)) b += p.FavoriteBonus;
            if (c.Origin.HasFlag(GapOrigin.Pantry)) b += p.PantryBonus;
            if (c.Origin.HasFlag(GapOrigin.Frequent)) b += p.FrequentBonus * Math.Min(1, Math.Log(1 + c.Familiarity) / Math.Log(11));
            if (ctx.Meal is { } meal && c.Slots?.Contains(meal) == true) b += p.SlotBonus;
            return b;
        }
        var avg = items.Average(i => One(i.Candidate));
        var together = false;
        for (var i = 0; i < items.Count && !together; i++)
            for (var j = i + 1; j < items.Count; j++)
                together |= CoEaten(ctx, items[i].Candidate, items[j].Candidate);
        return avg + (together ? p.CoEatenBonus : 0);
    }

    private static bool CoEaten(GapContext ctx, GapCandidate a, GapCandidate b) => ctx.CoEaten?.Contains(GapContext.PairKey(a.Key, b.Key)) == true;

    private static double Familiar(GapCandidate c) =>
        (c.Origin.HasFlag(GapOrigin.Favorite) ? 3 : 0) + (c.Origin.HasFlag(GapOrigin.Pantry) ? 2 : 0) + (c.Origin.HasFlag(GapOrigin.Frequent) ? 1 + Math.Min(1, c.Familiarity / 10.0) : 0);

    /// <summary>The most relevant candidates of a kind (by how much of the open needs one portion could cover), to keep combination search small.</summary>
    private static List<GapCandidate> Top(IEnumerable<GapCandidate> candidates, IReadOnlyList<GapTarget> open, GapFillPolicy p) =>
        candidates.OrderByDescending(c => Multiples(c, p).Max(m => NeedScore(c.PerPortion.Scale(m), open, p)) + Familiar(c) * 0.01)
            .ThenBy(c => c.Key, StringComparer.Ordinal).Take(p.CombinationPoolSize).ToList();

    private static string Anchor(GapSuggestion s) =>
        s.Items.OrderBy(i => i.Candidate.Role switch { GapRole.Meal => 0, GapRole.Main => 1, GapRole.Snack => 2, _ => 3 }).ThenBy(i => i.Candidate.Key, StringComparer.Ordinal).First().Candidate.Key;
}
