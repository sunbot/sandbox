namespace NutriPlan.Domain.Nutrients;

public enum ConsistencyStatus { Consistent, Suspicious, Inconsistent, Unknown }

public sealed record EnergyConsistencyResult(
    ConsistencyStatus Status,
    double ListedCalories,
    double ComputedCalories,
    double RelativeDifference,
    string Message);

/// <summary>
/// Sanity check that the listed calories agree with the macros (protein×4 + carbs×4 + fat×9 + alcohol×7).
/// Label data and crowd-sourced barcodes are frequently wrong; this flags them so the UI can warn.
/// Fiber is partially counted by labels in some regions, so the tolerance is deliberately generous.
/// </summary>
public static class EnergyConsistency
{
    public const double SuspiciousThreshold = 0.15;
    public const double InconsistentThreshold = 0.30;

    public static double ComputeAtwaterCalories(NutrientProfile p) =>
        p.Protein * 4 + p.Carbs * 4 + p.Fat * 9 + p.Get(NutrientIds.Alcohol) * 7;

    public static EnergyConsistencyResult Check(NutrientProfile per100g)
    {
        if (!per100g.Has(NutrientIds.Energy))
            return new(ConsistencyStatus.Unknown, 0, 0, 0, "No calorie value listed.");

        var listed = per100g.Calories;
        var computed = ComputeAtwaterCalories(per100g);

        // Very low-energy foods (water, spices, diet soda): absolute difference matters more than relative.
        if (listed < 20 && computed < 20)
            return new(ConsistencyStatus.Consistent, listed, computed, 0, "Low-calorie food.");

        var denominator = Math.Max(listed, computed);
        var relative = Math.Abs(listed - computed) / denominator;

        var status = relative switch
        {
            >= InconsistentThreshold => ConsistencyStatus.Inconsistent,
            >= SuspiciousThreshold => ConsistencyStatus.Suspicious,
            _ => ConsistencyStatus.Consistent,
        };

        var message = status switch
        {
            ConsistencyStatus.Consistent => "Calories match the macros.",
            _ => $"Listed {listed:0} kcal but macros add up to {computed:0} kcal per 100 g.",
        };

        return new(status, listed, computed, relative, message);
    }
}
