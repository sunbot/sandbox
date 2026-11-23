using NutriPlan.Application.Common;
using NutriPlan.Application.Diary;
using NutriPlan.Application.Planning;
using NutriPlan.Domain.Diary;
using NutriPlan.Domain.Planning;

namespace NutriPlan.Application.Tests;

/// <summary>Week: planned vs. logged integrity (un-log, skip/undo, future days, copying a day).</summary>
public class WeekTests
{
    private readonly InMemoryStore _store = new();
    private DiaryService Diary() => new(_store, _store, _store, _store, _store, _store);
    private PlanService Plan() => new(_store, _store, _store, Diary(), _store, _store);

    [Fact]
    public async Task Deleting_a_logged_planned_meal_puts_it_back_on_the_plan()
    {
        var oats = _store.AddFood("Oats", 379, 13, 68, 6.5);
        var planned = await Plan().AddFoodAsync(new AddPlanFoodRequest(_store.Today, MealSlot.Breakfast, oats.Id, 80, null, null));
        var logged = await Plan().MarkEatenAsync(planned.Id);

        await Diary().DeleteAsync(logged.Id);

        Assert.Empty(_store.Diary);
        Assert.Equal(PlanStatus.Planned, _store.Plan.Single().Status);
        var today = (await Plan().GetWeekAsync(_store.Today)).Days.Single(d => d.IsToday);
        Assert.Equal(0, today.Eaten.Calories);
        Assert.True(today.PlannedRemaining.Calories > 0);
        await Plan().MarkEatenAsync(planned.Id); // can be logged again
    }

    [Fact]
    public async Task Deleting_an_ordinary_log_does_not_touch_the_plan()
    {
        var oats = _store.AddFood("Oats", 379, 13, 68, 6.5);
        var planned = await Plan().AddFoodAsync(new AddPlanFoodRequest(_store.Today, MealSlot.Breakfast, oats.Id, 80, null, null));
        var other = await Diary().LogFoodAsync(new LogFoodRequest(_store.Today, MealSlot.Breakfast, oats.Id, 40, null, null));
        await Diary().DeleteAsync(other.Id);
        Assert.Equal(PlanStatus.Planned, _store.Plan.Single(p => p.Id == planned.Id).Status);
    }

    [Fact]
    public async Task Clearing_confirmed_entries_reopens_plans_and_leaves_other_entries_and_totals()
    {
        var date = _store.Today;
        var oats = _store.AddFood("Oats", 379, 13, 68, 6.5);
        var planned = await Plan().AddFoodAsync(new AddPlanFoodRequest(date, MealSlot.Breakfast, oats.Id, 80, null, null));
        var logged = await Plan().MarkEatenAsync(planned.Id);
        var other = await Diary().LogQuickAsync(new LogQuickRequest(date, MealSlot.Breakfast, "Other", 100, null, null, null));
        var later = await Diary().LogQuickAsync(new LogQuickRequest(date, MealSlot.Breakfast, "Added later", 50, null, null, null));
        await Diary().LogQuickAsync(new LogQuickRequest(date, MealSlot.Lunch, "Lunch", 200, null, null, null));
        await Diary().LogQuickAsync(new LogQuickRequest(date.AddDays(1), MealSlot.Breakfast, "Tomorrow", 300, null, null, null));
        var saves = _store.Saves;

        await Diary().ClearMealAsync(new ClearMealRequest(date, MealSlot.Breakfast, [logged.Id, other.Id]));

        Assert.Equal(saves + 1, _store.Saves);
        Assert.Equal(PlanStatus.Planned, _store.Plan.Single().Status);
        Assert.Contains(_store.Diary, e => e.Id == later.Id);
        Assert.Equal(3, _store.Diary.Count);
        Assert.Equal(250, (await Diary().GetDayAsync(date)).Totals.Calories);
    }

    [Fact]
    public async Task Clearing_stale_wrong_scope_or_invalid_selection_changes_nothing()
    {
        var date = _store.Today;
        var breakfast = await Diary().LogQuickAsync(new LogQuickRequest(date, MealSlot.Breakfast, "Breakfast", 100, null, null, null));
        var lunch = await Diary().LogQuickAsync(new LogQuickRequest(date, MealSlot.Lunch, "Lunch", 200, null, null, null));
        var tomorrow = await Diary().LogQuickAsync(new LogQuickRequest(date.AddDays(1), MealSlot.Breakfast, "Tomorrow", 300, null, null, null));
        var saves = _store.Saves;
        foreach (var ids in new[] { new[] { breakfast.Id, lunch.Id }, new[] { breakfast.Id, tomorrow.Id }, new[] { breakfast.Id, Guid.NewGuid() }, new[] { breakfast.Id, breakfast.Id }, Array.Empty<Guid>() })
            await Assert.ThrowsAsync<ValidationException>(() => Diary().ClearMealAsync(new ClearMealRequest(date, MealSlot.Breakfast, ids)));
        await Assert.ThrowsAsync<ValidationException>(() => Diary().ClearMealAsync(new ClearMealRequest(date, (MealSlot)999, [breakfast.Id])));
        Assert.Equal(saves, _store.Saves);
        Assert.Equal(3, _store.Diary.Count);
    }

    [Fact]
    public async Task A_skipped_meal_can_be_planned_again_but_a_logged_one_cannot()
    {
        var oats = _store.AddFood("Oats", 379, 13, 68, 6.5);
        var a = await Plan().AddFoodAsync(new AddPlanFoodRequest(_store.Today, MealSlot.Breakfast, oats.Id, 80, null, null));
        await Plan().MarkSkippedAsync(a.Id);
        Assert.Equal("Planned", (await Plan().ReopenAsync(a.Id)).Status);

        await Plan().MarkEatenAsync(a.Id);
        var ex = await Assert.ThrowsAsync<ValidationException>(() => Plan().ReopenAsync(a.Id));
        Assert.Contains("Delete it from the diary", ex.Message);
    }

    [Fact]
    public async Task Future_planned_meals_cannot_be_logged_as_eaten_early()
    {
        var oats = _store.AddFood("Oats", 379, 13, 68, 6.5);
        var tomorrow = await Plan().AddFoodAsync(new AddPlanFoodRequest(_store.Today.AddDays(1), MealSlot.Breakfast, oats.Id, 80, null, null));
        // With the device's own date the guard is exact; without it the server allows one day of slack for time zones.
        await Assert.ThrowsAsync<ValidationException>(() => Plan().MarkEatenAsync(tomorrow.Id, 1, _store.Today));
        var dayAfter = await Plan().AddFoodAsync(new AddPlanFoodRequest(_store.Today.AddDays(2), MealSlot.Breakfast, oats.Id, 80, null, null));
        await Assert.ThrowsAsync<ValidationException>(() => Plan().MarkEatenAsync(dayAfter.Id));
        Assert.Empty(_store.Diary);
        Assert.All(_store.Plan, e => Assert.Equal(PlanStatus.Planned, e.Status));
    }

    [Fact]
    public async Task Copying_a_day_copies_only_what_is_still_planned_and_logs_nothing()
    {
        var oats = _store.AddFood("Oats", 379, 13, 68, 6.5);
        var rice = _store.AddFood("Rice, white, cooked", 130, 2.7, 28, 0.3);
        var from = _store.Today;
        var a = await Plan().AddFoodAsync(new AddPlanFoodRequest(from, MealSlot.Breakfast, oats.Id, 80, null, null));
        await Plan().AddFoodAsync(new AddPlanFoodRequest(from, MealSlot.Dinner, rice.Id, 150, null, null));
        var skipped = await Plan().AddFoodAsync(new AddPlanFoodRequest(from, MealSlot.Lunch, rice.Id, 100, null, null));
        await Plan().MarkSkippedAsync(skipped.Id);
        await Plan().MarkEatenAsync(a.Id);

        var copies = await Plan().CopyAsync(from, from.AddDays(2), null);

        var copy = Assert.Single(copies);
        Assert.Equal("Dinner", copy.Meal);
        Assert.Equal(from.AddDays(2), copy.Date);
        Assert.Equal("Planned", copy.Status);
        Assert.Single(_store.Diary); // only the original "eaten"
        await Assert.ThrowsAsync<ValidationException>(() => Plan().CopyAsync(from.AddDays(5), from.AddDays(6), null));
    }

    [Fact]
    public async Task Moving_a_planned_meal_changes_day_and_meal_only()
    {
        var oats = _store.AddFood("Oats", 379, 13, 68, 6.5);
        var a = await Plan().AddFoodAsync(new AddPlanFoodRequest(_store.Today, MealSlot.Breakfast, oats.Id, 80, null, null));
        var moved = await Plan().MoveAsync(a.Id, _store.Today.AddDays(1), MealSlot.Snack);
        Assert.Equal("Snack", moved.Meal);
        Assert.Equal(a.Item.Nutrition.Calories, moved.Item.Nutrition.Calories);
        Assert.Empty(_store.Diary);
    }

    [Fact]
    public async Task Nutrient_totals_say_when_some_entries_have_no_data()
    {
        var oats = _store.AddFood("Oats", 379, 13, 68, 6.5);
        await Diary().LogFoodAsync(new LogFoodRequest(_store.Today, MealSlot.Breakfast, oats.Id, 80, null, null));
        await Diary().LogQuickAsync(new LogQuickRequest(_store.Today, MealSlot.Snack, "Cake", 420, null, null, null));

        var day = await Diary().GetDayAsync(_store.Today);
        Assert.Equal(0, day.Progress.Single(p => p.NutrientId == Domain.Nutrients.NutrientIds.Energy).MissingFrom);
        var fiber = day.Progress.Single(p => p.NutrientId == Domain.Nutrients.NutrientIds.Fiber);
        Assert.Equal(2, fiber.MissingFrom); // neither the test oats nor the quick entry report fiber
    }
}
