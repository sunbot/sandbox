namespace NutriPlan.Domain.Planning;

public sealed record DayBudgetInput(DateOnly Date, double ConsumedCalories, double PlannedRemainingCalories);

public sealed record DayBudget(
    DateOnly Date,
    double BaseTarget,
    double AdjustedTarget,
    double Consumed,
    double PlannedRemaining,
    bool IsPast,
    bool IsToday)
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
        var consumedPast = past.Sum(d => d.ConsumedCalories);

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
                d.Date == today);
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
}
