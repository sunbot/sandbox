namespace NutriPlan.Domain.Nutrients;

public enum NutrientGroup { Energy, Macronutrient, Lipid, Carbohydrate, Mineral, Vitamin, Other }

/// <summary>Whether hitting the target is good (Goal) or exceeding it is bad (Limit).</summary>
public enum TargetKind { Goal, Limit }

public sealed record NutrientDefinition(
    int Id,
    string Name,
    string Unit,
    NutrientGroup Group,
    double? DefaultTarget,
    TargetKind TargetKind,
    int DisplayOrder);

/// <summary>
/// The nutrients the app tracks and displays. Default targets are the FDA Daily Values
/// (adults and children 4+, 2016 labeling rule). They are sensible, sex-neutral starting
/// points; the user overrides them in their targets.
/// </summary>
public static class NutrientCatalog
{
    private static readonly NutrientDefinition[] Definitions =
    [
        new(NutrientIds.Energy, "Energy", "kcal", NutrientGroup.Energy, 2000, TargetKind.Goal, 0),
        new(NutrientIds.Protein, "Protein", "g", NutrientGroup.Macronutrient, 50, TargetKind.Goal, 10),
        new(NutrientIds.Carbohydrate, "Carbohydrates", "g", NutrientGroup.Macronutrient, 275, TargetKind.Goal, 20),
        new(NutrientIds.Fat, "Fat", "g", NutrientGroup.Macronutrient, 78, TargetKind.Goal, 30),
        new(NutrientIds.Fiber, "Fiber", "g", NutrientGroup.Carbohydrate, 28, TargetKind.Goal, 40),
        new(NutrientIds.SugarsTotal, "Sugars", "g", NutrientGroup.Carbohydrate, null, TargetKind.Limit, 41),
        new(NutrientIds.SugarsAdded, "Added sugars", "g", NutrientGroup.Carbohydrate, 50, TargetKind.Limit, 42),
        new(NutrientIds.SaturatedFat, "Saturated fat", "g", NutrientGroup.Lipid, 20, TargetKind.Limit, 50),
        new(NutrientIds.MonounsaturatedFat, "Monounsaturated fat", "g", NutrientGroup.Lipid, null, TargetKind.Goal, 51),
        new(NutrientIds.PolyunsaturatedFat, "Polyunsaturated fat", "g", NutrientGroup.Lipid, null, TargetKind.Goal, 52),
        new(NutrientIds.TransFat, "Trans fat", "g", NutrientGroup.Lipid, null, TargetKind.Limit, 53),
        new(NutrientIds.Cholesterol, "Cholesterol", "mg", NutrientGroup.Lipid, 300, TargetKind.Limit, 54),
        new(NutrientIds.Sodium, "Sodium", "mg", NutrientGroup.Mineral, 2300, TargetKind.Limit, 60),
        new(NutrientIds.Potassium, "Potassium", "mg", NutrientGroup.Mineral, 4700, TargetKind.Goal, 61),
        new(NutrientIds.Calcium, "Calcium", "mg", NutrientGroup.Mineral, 1300, TargetKind.Goal, 62),
        new(NutrientIds.Iron, "Iron", "mg", NutrientGroup.Mineral, 18, TargetKind.Goal, 63),
        new(NutrientIds.Magnesium, "Magnesium", "mg", NutrientGroup.Mineral, 420, TargetKind.Goal, 64),
        new(NutrientIds.Phosphorus, "Phosphorus", "mg", NutrientGroup.Mineral, 1250, TargetKind.Goal, 65),
        new(NutrientIds.Zinc, "Zinc", "mg", NutrientGroup.Mineral, 11, TargetKind.Goal, 66),
        new(NutrientIds.Copper, "Copper", "mg", NutrientGroup.Mineral, 0.9, TargetKind.Goal, 67),
        new(NutrientIds.Selenium, "Selenium", "µg", NutrientGroup.Mineral, 55, TargetKind.Goal, 68),
        new(NutrientIds.VitaminA, "Vitamin A", "µg", NutrientGroup.Vitamin, 900, TargetKind.Goal, 70),
        new(NutrientIds.VitaminC, "Vitamin C", "mg", NutrientGroup.Vitamin, 90, TargetKind.Goal, 71),
        new(NutrientIds.VitaminD, "Vitamin D", "µg", NutrientGroup.Vitamin, 20, TargetKind.Goal, 72),
        new(NutrientIds.VitaminE, "Vitamin E", "mg", NutrientGroup.Vitamin, 15, TargetKind.Goal, 73),
        new(NutrientIds.VitaminK, "Vitamin K", "µg", NutrientGroup.Vitamin, 120, TargetKind.Goal, 74),
        new(NutrientIds.Thiamin, "Thiamin (B1)", "mg", NutrientGroup.Vitamin, 1.2, TargetKind.Goal, 75),
        new(NutrientIds.Riboflavin, "Riboflavin (B2)", "mg", NutrientGroup.Vitamin, 1.3, TargetKind.Goal, 76),
        new(NutrientIds.Niacin, "Niacin (B3)", "mg", NutrientGroup.Vitamin, 16, TargetKind.Goal, 77),
        new(NutrientIds.VitaminB6, "Vitamin B6", "mg", NutrientGroup.Vitamin, 1.7, TargetKind.Goal, 78),
        new(NutrientIds.Folate, "Folate", "µg", NutrientGroup.Vitamin, 400, TargetKind.Goal, 79),
        new(NutrientIds.VitaminB12, "Vitamin B12", "µg", NutrientGroup.Vitamin, 2.4, TargetKind.Goal, 80),
        new(NutrientIds.Choline, "Choline", "mg", NutrientGroup.Vitamin, 550, TargetKind.Goal, 81),
        new(NutrientIds.Water, "Water", "g", NutrientGroup.Other, null, TargetKind.Goal, 90),
        new(NutrientIds.Alcohol, "Alcohol", "g", NutrientGroup.Other, null, TargetKind.Limit, 91),
    ];

    private static readonly Dictionary<int, NutrientDefinition> ById = Definitions.ToDictionary(d => d.Id);

    public static IReadOnlyList<NutrientDefinition> All => Definitions;

    public static IReadOnlySet<int> TrackedIds { get; } = Definitions.Select(d => d.Id).ToHashSet();

    public static NutrientDefinition? Find(int id) => ById.GetValueOrDefault(id);

    public static NutrientDefinition Get(int id) =>
        ById.TryGetValue(id, out var d) ? d : throw new KeyNotFoundException($"Nutrient {id} is not tracked.");
}
