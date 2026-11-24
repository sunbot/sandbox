namespace NutriPlan.Domain.Nutrients;

/// <summary>
/// Canonical nutrient identifiers. We reuse USDA FoodData Central nutrient ids so that
/// imported data maps 1:1 with no translation table. Every other source (Open Food Facts,
/// user-entered labels, ...) is mapped onto these ids at the edge.
/// </summary>
public static class NutrientIds
{
    // Energy & macros
    public const int Energy = 1008;                       // kcal
    public const int EnergyAtwaterGeneral = 2047;         // kcal (Foundation foods)
    public const int EnergyAtwaterSpecific = 2048;        // kcal (Foundation foods)
    public const int Protein = 1003;                      // g
    public const int Fat = 1004;                          // g
    public const int Carbohydrate = 1005;                 // g (by difference)
    public const int Fiber = 1079;                        // g
    public const int SugarsTotal = 2000;                  // g
    public const int SugarsTotalNlea = 1063;              // g (alternate id used by some datasets)
    public const int SugarsAdded = 1235;                  // g
    public const int Water = 1051;                        // g
    public const int Alcohol = 1018;                      // g

    // Lipids
    public const int SaturatedFat = 1258;                 // g
    public const int MonounsaturatedFat = 1292;           // g
    public const int PolyunsaturatedFat = 1293;           // g
    public const int TransFat = 1257;                     // g
    public const int Cholesterol = 1253;                  // mg

    // Minerals
    public const int Calcium = 1087;                      // mg
    public const int Iron = 1089;                         // mg
    public const int Magnesium = 1090;                    // mg
    public const int Phosphorus = 1091;                   // mg
    public const int Potassium = 1092;                    // mg
    public const int Sodium = 1093;                       // mg
    public const int Zinc = 1095;                         // mg
    public const int Copper = 1098;                       // mg
    public const int Selenium = 1103;                     // µg

    // Vitamins
    public const int VitaminA = 1106;                     // µg RAE
    public const int VitaminC = 1162;                     // mg
    public const int VitaminD = 1114;                     // µg
    public const int VitaminE = 1109;                     // mg
    public const int VitaminK = 1185;                     // µg
    public const int Thiamin = 1165;                      // mg
    public const int Riboflavin = 1166;                   // mg
    public const int Niacin = 1167;                       // mg
    public const int VitaminB6 = 1175;                    // mg
    public const int Folate = 1190;                       // µg DFE
    public const int FolateTotal = 1177;                  // µg (Foundation foods report this, not DFE)
    public const int FolicAcid = 1186;                    // µg (added; counts 1.7× in DFE)
    public const int FolateFood = 1187;                   // µg (naturally occurring)
    public const int VitaminB12 = 1178;                   // µg
    public const int Choline = 1180;                      // mg
}
