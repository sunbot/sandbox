using NutriPlan.Domain.Diary;
using NutriPlan.Domain.Foods;
using NutriPlan.Domain.Nutrients;
using NutriPlan.Domain.Planning;
using NutriPlan.Domain.Recipes;

namespace NutriPlan.Domain.Tests;

public class PlanningTests
{
    private static readonly DateOnly Monday = new(2026, 11, 16);

    [Fact]
    public void Week_start_respects_setting()
    {
        var thursday = Monday.AddDays(3);
        Assert.Equal(Monday, WeeklyBudgetCalculator.WeekStartFor(thursday, DayOfWeek.Monday));
        Assert.Equal(Monday.AddDays(-1), WeeklyBudgetCalculator.WeekStartFor(thursday, DayOfWeek.Sunday));
    }

    [Fact]
    public void Daily_mode_never_moves_targets()
    {
        var targets = new NutritionTargets { Calories = 2000, BudgetMode = BudgetMode.Daily };
        var days = Enumerable.Range(0, 7).Select(i => new DayBudgetInput(Monday.AddDays(i), i == 0 ? 2600 : 0, 0)).ToList();
        var week = WeeklyBudgetCalculator.Calculate(targets, Monday.AddDays(1), days);
        Assert.All(week.Days, d => Assert.Equal(2000, d.AdjustedTarget));
    }

    [Fact]
    public void Weekly_mode_spreads_an_overage_across_remaining_days()
    {
        var targets = new NutritionTargets { Calories = 2000, BudgetMode = BudgetMode.Weekly };
        // Monday was 600 over; today is Tuesday → 6 days absorb 600 → −100/day.
        var days = Enumerable.Range(0, 7).Select(i => new DayBudgetInput(Monday.AddDays(i), i == 0 ? 2600 : 0, 1900)).ToList();
        var week = WeeklyBudgetCalculator.Calculate(targets, Monday.AddDays(1), days);

        Assert.Equal(2000, week.Days[0].AdjustedTarget);
        Assert.All(week.Days.Skip(1), d => Assert.Equal(1900, d.AdjustedTarget));
        Assert.Equal(0, week.UnabsorbedCarryover);
    }

    [Fact]
    public void Weekly_mode_caps_adjustment_and_reports_the_rest()
    {
        var targets = new NutritionTargets { Calories = 2000, BudgetMode = BudgetMode.Weekly, MaxDailyAdjustment = 0.10 };
        // 6 days eaten at 3000 → 6000 over, only Sunday left; cap is −200.
        var days = Enumerable.Range(0, 7).Select(i => new DayBudgetInput(Monday.AddDays(i), i < 6 ? 3000 : 0, 0)).ToList();
        var week = WeeklyBudgetCalculator.Calculate(targets, Monday.AddDays(6), days);
        Assert.Equal(1800, week.Days[6].AdjustedTarget);
        Assert.Equal(-5800, week.UnabsorbedCarryover);
    }

    [Fact]
    public void Plan_entry_becomes_diary_entry_linked_to_plan()
    {
        var item = ItemSnapshot.QuickCalories("Oatmeal", 300);
        var plan = new PlanEntry(Monday, MealSlot.Breakfast, item);
        var diary = plan.ToDiaryEntry(scale: 1.5);
        Assert.Equal(PlanStatus.Eaten, plan.Status);
        Assert.Equal(plan.Id, diary.PlanEntryId);
        Assert.Equal(450, diary.Item.Nutrients.Calories);
    }

    [Fact]
    public void Recipe_nutrition_is_sum_of_ingredients_per_serving_with_coverage()
    {
        var oats = new Food("Oats", FoodSource.UsdaSrLegacy, Profile(379, 13.2, 67.7, 6.5));
        var milk = new Food("Milk", FoodSource.UsdaSrLegacy, Profile(61, 3.2, 4.8, 3.3));
        var recipe = new Recipe("Overnight oats", 2);
        recipe.SetIngredientLines(["1 cup oats", "2 cups milk", "pinch of cinnamon", "TOPPINGS"]);
        var ing = recipe.Ingredients.ToList();
        ing[0].FoodId = oats.Id; ing[0].Grams = 80; ing[0].Status = IngredientMatchStatus.Confirmed;
        ing[1].FoodId = milk.Id; ing[1].Grams = 488; ing[1].Status = IngredientMatchStatus.AutoMatched;

        var result = RecipeNutritionCalculator.Calculate(recipe, new Dictionary<Guid, Food> { [oats.Id] = oats, [milk.Id] = milk });

        Assert.Equal(IngredientMatchStatus.Ignored, ing[3].Status); // header
        Assert.Equal((379 * 0.8 + 61 * 4.88) / 2, result.PerServing.Calories, 6);
        Assert.Equal(2.0 / 3, result.Coverage, 6); // cinnamon unmatched
        Assert.Single(result.Warnings);
    }

    private static NutrientProfile Profile(double kcal, double p, double c, double f) => new(new Dictionary<int, double>
    {
        [NutrientIds.Energy] = kcal, [NutrientIds.Protein] = p, [NutrientIds.Carbohydrate] = c, [NutrientIds.Fat] = f,
    });
}
