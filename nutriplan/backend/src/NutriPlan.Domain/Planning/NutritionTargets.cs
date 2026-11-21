using NutriPlan.Domain.Nutrients;

namespace NutriPlan.Domain.Planning;

public enum BudgetMode
{
    /// <summary>Each day stands alone. Going over today doesn't change tomorrow.</summary>
    Daily,
    /// <summary>The week has a calorie budget; over/under is spread across the remaining days.</summary>
    Weekly,
}

/// <summary>The user's daily goals. Single row for a personal app; add an owner id to go multi-user.</summary>
public sealed class NutritionTargets : Users.IOwned
{
    /// <summary>Each user has their own targets: the owner is the key.</summary>
    public Guid OwnerId { get; private set; }
    public void AssignOwner(Guid ownerId) => OwnerId = Users.Ownership.Assign(OwnerId, ownerId);
    public double Calories { get; set; } = 2000;
    public double ProteinGrams { get; set; } = 120;
    public double CarbGrams { get; set; } = 200;
    public double FatGrams { get; set; } = 67;
    public BudgetMode BudgetMode { get; set; } = BudgetMode.Daily;
    public DayOfWeek WeekStartsOn { get; set; } = DayOfWeek.Monday;
    /// <summary>In weekly mode, how far a single day may move from the base target (0.15 = ±15 %).</summary>
    public double MaxDailyAdjustment { get; set; } = 0.15;
    /// <summary>Overrides for micronutrient targets, by nutrient id. Unset nutrients use the catalog default.</summary>
    public Dictionary<int, double> NutrientOverrides { get; set; } = new();
    /// <summary>Nutrients shown in the weekly heatmap and used by the gap filler. Empty = sensible default set.</summary>
    public List<int> FocusNutrients { get; set; } = [];

    public static readonly int[] DefaultFocusNutrients =
    [
        NutrientIds.Fiber, NutrientIds.Calcium, NutrientIds.Iron, NutrientIds.Magnesium, NutrientIds.Potassium,
        NutrientIds.Zinc, NutrientIds.VitaminA, NutrientIds.VitaminC, NutrientIds.VitaminD, NutrientIds.VitaminK,
        NutrientIds.Folate, NutrientIds.VitaminB12, NutrientIds.Sodium, NutrientIds.SaturatedFat, NutrientIds.SugarsAdded,
    ];

    public IReadOnlyList<int> EffectiveFocusNutrients => FocusNutrients.Count > 0 ? FocusNutrients : DefaultFocusNutrients;

    public double? TargetFor(int nutrientId) => nutrientId switch
    {
        NutrientIds.Energy => Calories,
        NutrientIds.Protein => ProteinGrams,
        NutrientIds.Carbohydrate => CarbGrams,
        NutrientIds.Fat => FatGrams,
        _ when NutrientOverrides.TryGetValue(nutrientId, out var v) => v,
        _ => NutrientCatalog.Find(nutrientId)?.DefaultTarget,
    };

    public TargetKind KindFor(int nutrientId) => NutrientCatalog.Find(nutrientId)?.TargetKind ?? TargetKind.Goal;

    /// <summary>The daily targets as a profile (only nutrients that have a target).</summary>
    public NutrientProfile AsProfile(IEnumerable<int>? nutrientIds = null)
    {
        var ids = nutrientIds ?? new[] { NutrientIds.Energy, NutrientIds.Protein, NutrientIds.Carbohydrate, NutrientIds.Fat }
            .Concat(EffectiveFocusNutrients);
        var dict = new Dictionary<int, double>();
        foreach (var id in ids.Distinct())
            if (TargetFor(id) is { } t) dict[id] = t;
        return new NutrientProfile(dict);
    }

    /// <summary>Macro split as calorie percentages, handy for the UI.</summary>
    public (double Protein, double Carbs, double Fat) MacroPercentages()
    {
        var p = ProteinGrams * 4; var c = CarbGrams * 4; var f = FatGrams * 9;
        var sum = p + c + f;
        return sum == 0 ? (0, 0, 0) : (p / sum, c / sum, f / sum);
    }
}
