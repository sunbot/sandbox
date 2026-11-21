using NutriPlan.Application.Diary;
using NutriPlan.Application.Insights;
using NutriPlan.Domain.Diary;
using NutriPlan.Domain.Foods;
using NutriPlan.Domain.Nutrients;

namespace NutriPlan.Application.Tests;

/// <summary>Nutrient Insights heatmap: unknown vs zero, finished-day averages, and honest weekly notes.</summary>
public class InsightsTests
{
    private readonly InMemoryStore _store = new(); // Today = Wed 18 Nov 2026
    private DiaryService Diary() => new(_store, _store, _store, _store, _store, _store);
    private InsightsService Insights() => new(_store, _store, _store);

    private Food FiberFood(double fiber) => AddWith("Lentils, cooked", new() { [NutrientIds.Energy] = 116, [NutrientIds.Protein] = 9, [NutrientIds.Carbohydrate] = 20, [NutrientIds.Fat] = 0.4, [NutrientIds.Fiber] = fiber });
    private Food NoFiberData() => AddWith("Mystery bar", new() { [NutrientIds.Energy] = 400, [NutrientIds.Protein] = 10, [NutrientIds.Carbohydrate] = 60, [NutrientIds.Fat] = 12 });

    private Food AddWith(string name, Dictionary<int, double> n)
    {
        var f = new Food(name, FoodSource.UsdaSrLegacy, new NutrientProfile(n));
        _store.Foods.Add(f);
        return f;
    }

    private Task Log(DateOnly d, Food f, double grams) => Diary().LogFoodAsync(new LogFoodRequest(d, MealSlot.Lunch, f.Id, grams, null, null));

    private static HeatmapRowDto Row(HeatmapDto h, int id) => h.Rows.Single(r => r.NutrientId == id);

    [Fact]
    public async Task Entries_without_a_nutrient_are_counted_as_missing_not_zero()
    {
        await Log(_store.Today.AddDays(-1), FiberFood(8), 100);
        await Log(_store.Today.AddDays(-1), NoFiberData(), 50);
        var h = await Insights().GetHeatmapAsync(_store.Today);
        var cell = Row(h, NutrientIds.Fiber).Days.Single(c => c.Date == _store.Today.AddDays(-1));
        Assert.Equal(8, cell.Amount);
        Assert.Equal(1, cell.MissingFrom);
        Assert.Equal(1, Row(h, NutrientIds.Fiber).IncompleteDays);
        Assert.Equal(0, Row(h, NutrientIds.Protein).Days.Single(c => c.Date == _store.Today.AddDays(-1)).MissingFrom);
    }

    [Fact]
    public async Task Averages_cover_finished_days_only_and_today_never_drags_them_down()
    {
        var lentils = FiberFood(8);
        await Log(_store.Today.AddDays(-2), lentils, 200); // 16 g fiber
        await Log(_store.Today.AddDays(-1), lentils, 100); // 8 g
        await Log(_store.Today, lentils, 10);              // today, still under way
        var row = Row(await Insights().GetHeatmapAsync(_store.Today), NutrientIds.Fiber);
        Assert.Equal(2, row.CompletedDays);
        Assert.Equal(12, row.AverageAmount);
        Assert.InRange(row.WeeklyAveragePercent, 12 / row.Target * 100 - 0.2, 12 / row.Target * 100 + 0.2);
        Assert.NotNull(row.Days.Single(c => c.Date == _store.Today).Percent); // today is still shown, just not averaged
    }

    [Fact]
    public async Task The_device_date_decides_which_days_are_finished()
    {
        var lentils = FiberFood(8);
        await Log(_store.Today, lentils, 100);
        Assert.Equal(0, Row(await Insights().GetHeatmapAsync(_store.Today), NutrientIds.Fiber).CompletedDays);
        Assert.Equal(1, Row(await Insights().GetHeatmapAsync(_store.Today, _store.Today.AddDays(1)), NutrientIds.Fiber).CompletedDays);
    }

    [Fact]
    public async Task No_weekly_pattern_is_claimed_from_too_few_finished_days()
    {
        await Log(_store.Today.AddDays(-1), FiberFood(1), 50);
        var h = await Insights().GetHeatmapAsync(_store.Today);
        Assert.Single(h.Highlights);
        Assert.Contains("Weekly patterns appear after 3", h.Highlights[0]);
        Assert.DoesNotContain(h.Highlights, n => n.Contains("low", StringComparison.OrdinalIgnoreCase));

        var empty = await new InsightsService(new InMemoryStore(), _store, _store).GetHeatmapAsync(_store.Today);
        Assert.Equal(["Nothing logged this week yet."], empty.Highlights);
    }

    [Fact]
    public async Task A_nutrient_with_missing_data_is_never_called_below_goal()
    {
        // Monday 16 … Wednesday 18: three finished days when "today" is Thursday.
        var thursday = _store.Today.AddDays(1);
        foreach (var d in new[] { -2, -1, 0 })
        {
            await Log(_store.Today.AddDays(d), FiberFood(1), 100);       // 1 g fiber: far below goal
            await Log(_store.Today.AddDays(d), NoFiberData(), 50);       // …but this entry has no fiber data
        }
        var h = await Insights().GetHeatmapAsync(_store.Today, thursday);
        Assert.Equal(3, Row(h, NutrientIds.Fiber).CompletedDays);
        Assert.DoesNotContain(h.Highlights, n => n.Contains("Fiber"));
    }

    [Fact]
    public async Task Three_complete_finished_days_below_goal_are_reported_with_the_day_count()
    {
        var thursday = _store.Today.AddDays(1);
        foreach (var d in new[] { -2, -1, 0 }) await Log(_store.Today.AddDays(d), FiberFood(1), 100);
        var h = await Insights().GetHeatmapAsync(_store.Today, thursday);
        Assert.Contains(h.Highlights, n => n.StartsWith("Below goal on average over 3 finished days") && n.Contains("Fiber"));
    }

    [Theory]
    [InlineData(NutrientIds.Carbohydrate, 115, "high")]
    [InlineData(NutrientIds.Carbohydrate, 105, "good")]
    [InlineData(NutrientIds.Fat, 120, "high")]
    [InlineData(NutrientIds.Protein, 150, "good")]
    public void Carbs_and_fat_well_past_target_are_marked_high(int id, double pct, string level) =>
        Assert.Equal(level, InsightsService.Level(pct, TargetKind.Goal, id));

    [Fact]
    public void Over_target_carbs_are_reported_as_over_not_as_a_win()
    {
        HeatmapRowDto Make(int id, string name, double pct) => new(id, name, "g", "Goal", 100, pct, [], 100, 3, 0);
        var notes = InsightsService.Highlights([Make(NutrientIds.Carbohydrate, "Carbohydrates", 120), Make(NutrientIds.Protein, "Protein", 105)], 3, 3);
        Assert.Contains(notes, n => n.StartsWith("Over target on average: Carbohydrates (120%)"));
        Assert.Contains(notes, n => n.StartsWith("Goal met on average: Protein"));
        Assert.DoesNotContain(notes, n => n.StartsWith("Goal met") && n.Contains("Carbohydrates"));
    }
}
