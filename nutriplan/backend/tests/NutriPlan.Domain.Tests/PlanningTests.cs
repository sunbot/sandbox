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

    [Theory]
    [InlineData(0.10, 1260, 1540)]
    [InlineData(0.15, 1190, 1610)]
    [InlineData(0.20, 1120, 1680)]
    [InlineData(0.25, 1050, 1750)]
    public void Daily_range_follows_the_flexibility_setting(double adj, double min, double max)
    {
        var targets = new NutritionTargets { Calories = 1400, BudgetMode = BudgetMode.Weekly, MaxDailyAdjustment = adj };
        Assert.Equal((min, max), WeeklyBudgetCalculator.DailyRange(targets));
    }

    [Fact]
    public void Daily_range_rounds_and_collapses_when_each_day_stands_alone()
    {
        Assert.Equal((1730, 2271), WeeklyBudgetCalculator.DailyRange(new NutritionTargets { Calories = 2000.5, BudgetMode = BudgetMode.Weekly, MaxDailyAdjustment = 0.135 }));
        Assert.Equal((2000, 2000), WeeklyBudgetCalculator.DailyRange(new NutritionTargets { Calories = 2000, BudgetMode = BudgetMode.Daily }));
    }

    [Fact]
    public void Preview_matches_the_production_calculation_for_the_following_days()
    {
        var targets = new NutritionTargets { Calories = 2000, BudgetMode = BudgetMode.Weekly, MaxDailyAdjustment = 0.25 };
        var days = Enumerable.Range(0, 7).Select(i => new DayBudgetInput(Monday.AddDays(i), 0, 0)).ToList();
        var today = Monday.AddDays(1); // 5 days remain after today
        var p = WeeklyBudgetCalculator.Preview(targets, today, days, 500);
        Assert.Equal(2000, p.TodayTarget);
        Assert.Equal(5, p.DaysAfterToday);
        Assert.Equal(1900, p.NextDaysTarget); // 500 over, spread over 5 days
        Assert.False(p.CapReached);

        var asLogged = days.Select(d => d.Date == today ? d with { ConsumedCalories = 2500 } : d).ToList();
        var real = WeeklyBudgetCalculator.Calculate(targets, today.AddDays(1), asLogged);
        Assert.Equal(real.Days[2].AdjustedTarget, p.NextDaysTarget);
    }

    [Fact]
    public void Preview_reports_cap_saturation_and_never_exceeds_the_cap()
    {
        var targets = new NutritionTargets { Calories = 2000, BudgetMode = BudgetMode.Weekly, MaxDailyAdjustment = 0.10 };
        var days = Enumerable.Range(0, 7).Select(i => new DayBudgetInput(Monday.AddDays(i), 0, 0)).ToList();
        var p = WeeklyBudgetCalculator.Preview(targets, Monday.AddDays(5), days, 2000);
        Assert.Equal(1800, p.NextDaysTarget);
        Assert.True(p.CapReached);
        Assert.Equal(-1800, p.UnabsorbedCarryover); // 2000 over, Sunday absorbs at most 200
    }

    [Fact]
    public void Preview_has_no_example_on_the_last_day_or_when_days_stand_alone()
    {
        var days = Enumerable.Range(0, 7).Select(i => new DayBudgetInput(Monday.AddDays(i), 0, 0)).ToList();
        var weekly = new NutritionTargets { Calories = 2000, BudgetMode = BudgetMode.Weekly };
        Assert.Null(WeeklyBudgetCalculator.Preview(weekly, Monday.AddDays(6), days, 300).NextDaysTarget);
        var daily = new NutritionTargets { Calories = 2000, BudgetMode = BudgetMode.Daily };
        Assert.Null(WeeklyBudgetCalculator.Preview(daily, Monday, days, 300).NextDaysTarget);
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
