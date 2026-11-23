namespace NutriPlan.Domain.Planning;

public sealed record DayBudgetInput(DateOnly Date, double ConsumedCalories, double PlannedRemainingCalories);

public sealed record DayBudget(
    DateOnly Date,
    double BaseTarget,
    double AdjustedTarget,
    double Consumed,
    double PlannedRemaining,
    bool IsPast,
    bool IsToday,
    bool IsUntracked = false)
{
    /// <summary>Consumed + still planned for the day.</summary>
    public double Projected => Consumed + PlannedRemaining;
    /// <summary>Positive = room left, negative = over.</summary>
    public double Remaining => AdjustedTarget - Consumed;
    /// <summary>How far the plan is from the (adjusted) target. Positive = plan is over target.</summary>
    public double PlanDelta => Projected - AdjustedTarget;
}

public sealed record WeekBudget(
    DateOnly WeekStart,
    BudgetMode Mode,
    double WeeklyTarget,
    double ConsumedSoFar,
    double ProjectedTotal,
    double UnabsorbedCarryover,
    IReadOnlyList<DayBudget> Days);

/// <summary>What a flexibility setting allows (<see cref="MinTarget"/>–<see cref="MaxTarget"/> a day) and, in weekly mode,
/// roughly what the days after today become if today ends <see cref="ExtraKcal"/> over its target. A preview only.</summary>
public sealed record BudgetPreview(
    double BaseTarget,
    double MinTarget,
    double MaxTarget,
    double TodayTarget,
    double ExtraKcal,
    int DaysAfterToday,
    double? NextDaysTarget,
    bool CapReached,
    double UnabsorbedCarryover);

/// <summary>
/// "I strayed, now what?" In weekly mode, whatever was eaten over/under on past days is spread
/// across the remaining days (including today), capped at ±<see cref="NutritionTargets.MaxDailyAdjustment"/>
/// so no single day becomes unreasonable. Whatever can't be absorbed is reported, not hidden.
/// </summary>
public static class WeeklyBudgetCalculator
{
    public static DateOnly WeekStartFor(DateOnly date, DayOfWeek weekStartsOn)
    {
        var diff = ((int)date.DayOfWeek - (int)weekStartsOn + 7) % 7;
        return date.AddDays(-diff);
    }

    public static WeekBudget Calculate(NutritionTargets targets, DateOnly today, IReadOnlyList<DayBudgetInput> days)
    {
        if (days.Count == 0) throw new ArgumentException("At least one day is required.", nameof(days));
        var ordered = days.OrderBy(d => d.Date).ToList();
        var baseTarget = targets.Calories;
        var weeklyTarget = baseTarget * ordered.Count;

        var past = ordered.Where(d => d.Date < today).ToList();
        var remainingDays = ordered.Where(d => d.Date >= today).ToList();
        // A past day with nothing logged wasn't tracked, not fasted: count it as on target.
        var consumedPast = past.Sum(d => d.ConsumedCalories > 0 ? d.ConsumedCalories : baseTarget);

        double adjusted = baseTarget;
        double unabsorbed = 0;

        if (targets.BudgetMode == BudgetMode.Weekly && remainingDays.Count > 0)
        {
            var carryover = baseTarget * past.Count - consumedPast; // + means under-ate so far
            var perDay = carryover / remainingDays.Count;
            var cap = baseTarget * targets.MaxDailyAdjustment;
            var clamped = Math.Clamp(perDay, -cap, cap);
            adjusted = baseTarget + clamped;
            unabsorbed = (perDay - clamped) * remainingDays.Count;
        }

        var result = ordered.Select(d =>
        {
            var isPast = d.Date < today;
            return new DayBudget(
                d.Date,
                baseTarget,
                isPast ? baseTarget : Math.Round(adjusted),
                d.ConsumedCalories,
                isPast ? 0 : d.PlannedRemainingCalories,
                isPast,
                d.Date == today,
                isPast && d.ConsumedCalories <= 0);
        }).ToList();

        return new WeekBudget(
            ordered[0].Date,
            targets.BudgetMode,
            weeklyTarget,
            ordered.Sum(d => d.ConsumedCalories),
            result.Sum(d => d.Projected),
            Math.Round(unabsorbed),
            result);
    }

    /// <summary>Allowed daily range for the setting. Each day stands alone → exactly the base target.</summary>
    public static (double Min, double Max) DailyRange(NutritionTargets targets)
    {
        if (targets.BudgetMode != BudgetMode.Weekly) return (Math.Round(targets.Calories), Math.Round(targets.Calories));
        var cap = targets.Calories * targets.MaxDailyAdjustment;
        return (Math.Round(targets.Calories - cap), Math.Round(targets.Calories + cap));
    }

    /// <summary>Runs the same <see cref="Calculate"/> twice: once as things stand, once with today ending at its adjusted
    /// target plus <paramref name="extraKcal"/> (so the following days absorb it, within the cap).</summary>
    public static BudgetPreview Preview(NutritionTargets targets, DateOnly today, IReadOnlyList<DayBudgetInput> days, double extraKcal)
    {
        var now = Calculate(targets, today, days);
        var todayBudget = now.Days.FirstOrDefault(d => d.IsToday);
        var (min, max) = DailyRange(targets);
        var after = days.Count(d => d.Date > today);
        var todayTarget = todayBudget?.AdjustedTarget ?? Math.Round(targets.Calories);
        if (targets.BudgetMode != BudgetMode.Weekly || todayBudget is null || after == 0)
            return new BudgetPreview(targets.Calories, min, max, todayTarget, extraKcal, after, null, false, 0);

        var ate = todayTarget + extraKcal;
        var hypothetical = days.Select(d => d.Date == today ? d with { ConsumedCalories = ate } : d).ToList();
        var next = Calculate(targets, today.AddDays(1), hypothetical);
        var nextTarget = next.Days.First(d => d.Date > today).AdjustedTarget;
        return new BudgetPreview(targets.Calories, min, max, todayTarget, extraKcal, after, nextTarget,
            next.UnabsorbedCarryover != 0, next.UnabsorbedCarryover);
    }
}
