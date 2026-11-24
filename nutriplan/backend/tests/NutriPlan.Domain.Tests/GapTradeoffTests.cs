using NutriPlan.Domain.Diary;
using NutriPlan.Domain.Nutrients;
using NutriPlan.Domain.Planning;

namespace NutriPlan.Domain.Tests;

/// <summary>
/// Issue #87: a Greek salad (828 kcal, 11 g protein) ranked first on a day with 1,038 kcal and 115 g protein left. These
/// scenarios fix how a suggestion's nutrient help is weighed against the calories it uses and the protein still missing.
/// </summary>
public class GapTradeoffTests
{
    private static readonly GapFillPolicy P = new();

    private static NutrientProfile N(double kcal, double protein, double fiber, double k, double mg, double fe, double c, double a, double vk, double folate) =>
        new(new Dictionary<int, double>
        {
            [NutrientIds.Energy] = kcal, [NutrientIds.Protein] = protein, [NutrientIds.Fiber] = fiber, [NutrientIds.Potassium] = k,
            [NutrientIds.Magnesium] = mg, [NutrientIds.Iron] = fe, [NutrientIds.VitaminC] = c, [NutrientIds.VitaminA] = a,
            [NutrientIds.VitaminK] = vk, [NutrientIds.Folate] = folate, [NutrientIds.Sodium] = 600,
        });

    private static GapCandidate Recipe(string name, NutrientProfile n) =>
        new($"r:{name}", ItemKind.Recipe, null, Guid.NewGuid(), name, GapRole.Meal, FoodGroup.Other, GapOrigin.SavedRecipe, n, 1, "serving", "1 serving");

    /// <summary>The screenshot day: 1,038 kcal, 115 g protein and 23 g fiber still missing, and most micronutrients short.</summary>
    public static List<GapTarget> ScreenshotDay() =>
    [
        new(NutrientIds.Energy, 1038, 2000, TargetKind.Goal, 4),
        new(NutrientIds.Protein, 115, 130, TargetKind.Goal, P.ProteinWeight),
        new(NutrientIds.Fiber, 23, 28, TargetKind.Goal, P.FiberWeight),
        new(NutrientIds.Potassium, 3000, 4700, TargetKind.Goal, P.MicronutrientWeight),
        new(NutrientIds.Magnesium, 300, 420, TargetKind.Goal, P.MicronutrientWeight),
        new(NutrientIds.Iron, 12, 18, TargetKind.Goal, P.MicronutrientWeight),
        new(NutrientIds.VitaminC, 80, 90, TargetKind.Goal, P.MicronutrientWeight),
        new(NutrientIds.VitaminA, 700, 900, TargetKind.Goal, P.MicronutrientWeight),
        new(NutrientIds.VitaminK, 100, 120, TargetKind.Goal, P.MicronutrientWeight),
        new(NutrientIds.Folate, 300, 400, TargetKind.Goal, P.MicronutrientWeight),
        new(NutrientIds.Sodium, 1500, 2300, TargetKind.Limit, 1),
    ];

    public static GapCandidate Salad() => Recipe("Greek salad", N(828, 11, 12, 1500, 150, 5, 70, 600, 100, 200));
    public static GapCandidate ChickenBowl() => Recipe("Chicken, rice and broccoli bowl", N(600, 50, 7, 900, 110, 3, 60, 120, 110, 90));
    public static GapCandidate SalmonQuinoa() => Recipe("Salmon, quinoa and spinach", N(650, 42, 8, 1400, 160, 4.5, 25, 450, 300, 180));

    [Fact]
    public void A_low_protein_dish_using_most_of_the_calories_ranks_below_protein_rich_meals_and_says_why()
    {
        var s = GapRecommender.Suggest(ScreenshotDay(), [Salad(), ChickenBowl(), SalmonQuinoa()], GapMode.BestMatch, new GapContext(), P);
        Assert.Equal(["Chicken, rice and broccoli bowl", "Salmon, quinoa and spinach", "Greek salad"], s.Select(x => x.Items[0].Candidate.Name));
        var salad = s.Single(x => x.Items[0].Candidate.Name == "Greek salad");
        var why = Assert.Single(salad.Reasons, r => r.Code == "pacing");
        Assert.Equal("Uses 80% of your remaining calories but only 10% of the 115 g protein still needed", why.Text);
        Assert.DoesNotContain(s.Single(x => x.Items[0].Candidate.Name.StartsWith("Chicken")).Reasons, r => r.Code == "pacing");
    }

    [Fact]
    public void Pacing_is_a_ranking_trade_off_not_a_filter_and_ignores_days_without_a_protein_gap()
    {
        // Alone, the salad is still offered: it does help fiber and micronutrients.
        Assert.Single(GapRecommender.Suggest(ScreenshotDay(), [Salad()], GapMode.BestMatch, new GapContext(), P));
        // Protein already met: no pacing penalty, no caution.
        var met = ScreenshotDay().Select(n => n.NutrientId == NutrientIds.Protein ? n with { Remaining = 5 } : n).ToList();
        var open = GapRecommender.OpenNeeds(met, P);
        Assert.Equal(0, GapRecommender.ProteinPacingShortfall(Salad().PerPortion, 1038, open));
        var only = Assert.Single(GapRecommender.Suggest(met, [Salad()], GapMode.BestMatch, new GapContext(), P));
        Assert.DoesNotContain(only.Reasons, r => r.Code == "pacing");
    }

    [Theory]
    [InlineData(828, 11, 0.62)]   // the salad: 80% of calories, 10% of protein, × priority 0.885
    [InlineData(600, 50, 0.13)]   // keeps nearly even pace
    [InlineData(300, 60, 0)]      // more protein than calories, proportionally: no penalty
    public void Pacing_shortfall_is_the_calorie_share_beyond_the_protein_share(double kcal, double protein, double expected)
    {
        var open = GapRecommender.OpenNeeds(ScreenshotDay(), P);
        var added = new NutrientProfile(new Dictionary<int, double> { [NutrientIds.Energy] = kcal, [NutrientIds.Protein] = protein });
        Assert.Equal(expected, GapRecommender.ProteinPacingShortfall(added, 1038, open), 2);
    }
}
