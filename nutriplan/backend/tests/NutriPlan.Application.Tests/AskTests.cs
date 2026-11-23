using NutriPlan.Application.Abstractions;
using NutriPlan.Application.Common;
using NutriPlan.Application.Diary;
using NutriPlan.Application.Foods;
using NutriPlan.Application.Planning;
using NutriPlan.Domain.Diary;
using NutriPlan.Domain.Foods;

namespace NutriPlan.Application.Tests;

/// <summary>Ask's unified confirmation: multi-food log/plan, quantity status, and intent routing.</summary>
public class AskTests
{
    private readonly InMemoryStore _store = new();
    private DiaryService Diary() => new(_store, _store, _store, _store, _store, _store);
    private PlanService Plan() => new(_store, _store, _store, Diary(), _store, _store);
    private FoodService Foods() => new(_store, [], _store);

    [Fact]
    public async Task Log_all_saves_every_food_together()
    {
        var egg = _store.AddFood("Egg, whole, raw", 143, 12.6, 0.7, 9.5, portions: new FoodPortion("large", 50));
        var toast = _store.AddFood("Bread, toasted", 293, 9, 54, 4, portions: new FoodPortion("slice", 28));

        var entries = await Diary().LogFoodsAsync(new LogFoodsRequest(_store.Today, MealSlot.Breakfast,
            [new FoodAmount(egg.Id, null, 2, "large"), new FoodAmount(toast.Id, 28, null, null)]));

        Assert.Equal(2, entries.Count);
        Assert.Equal(100, entries[0].Item.Grams);
        Assert.All(entries, e => Assert.Equal("Breakfast", e.Meal));
        Assert.Equal(1, _store.Saves); // one save for the whole meal
        Assert.Equal(143 + 82, (await Diary().GetDayAsync(_store.Today)).Totals.Calories, 0);
    }

    [Fact]
    public async Task Log_all_saves_nothing_when_one_food_is_invalid()
    {
        var egg = _store.AddFood("Egg, whole, raw", 143, 12.6, 0.7, 9.5, portions: new FoodPortion("large", 50));
        var chicken = _store.AddFood("Chicken breast, raw", 120, 22.5, 0, 2.6); // no cup measure

        var ex = await Assert.ThrowsAsync<ValidationException>(() => Diary().LogFoodsAsync(new LogFoodsRequest(_store.Today, MealSlot.Lunch,
            [new FoodAmount(egg.Id, null, 2, "large"), new FoodAmount(chicken.Id, null, 1, "cup")])));

        Assert.Contains("Item 2", ex.Message);
        Assert.Contains("Nothing was saved", ex.Message);
        Assert.Empty(_store.Diary);
        Assert.Equal(0, _store.Saves);
    }

    [Fact]
    public async Task Log_all_rejects_an_empty_meal_and_unknown_foods()
    {
        await Assert.ThrowsAsync<ValidationException>(() => Diary().LogFoodsAsync(new LogFoodsRequest(_store.Today, MealSlot.Lunch, [])));
        var ex = await Assert.ThrowsAsync<ValidationException>(() => Diary().LogFoodsAsync(new LogFoodsRequest(_store.Today, MealSlot.Lunch,
            [new FoodAmount(Guid.NewGuid(), 100, null, null)])));
        Assert.Contains("Item 1", ex.Message);
        Assert.Empty(_store.Diary);
    }

    [Fact]
    public async Task Plan_all_plans_without_counting_anything_as_eaten()
    {
        var salmon = _store.AddFood("Fish, salmon, raw", 208, 20, 0, 13);
        var rice = _store.AddFood("Rice, white, cooked", 130, 2.7, 28, 0.3, portions: new FoodPortion("cup", 158));
        var friday = _store.Today.AddDays(2);

        var planned = await Plan().AddFoodsAsync(new AddPlanFoodsRequest(friday, MealSlot.Dinner,
            [new FoodAmount(salmon.Id, 150, null, null), new FoodAmount(rice.Id, null, 1, "cup")]));

        Assert.Equal(2, planned.Count);
        Assert.All(planned, p => Assert.Equal("Planned", p.Status));
        Assert.Empty(_store.Diary);
        var day = (await Plan().GetWeekAsync(friday)).Days.Single(d => d.Date == friday);
        Assert.Equal(0, day.Eaten.Calories);
        Assert.True(day.PlannedRemaining.Calories > 0);
    }

    [Fact]
    public async Task Plan_all_saves_nothing_when_one_food_is_invalid()
    {
        var salmon = _store.AddFood("Fish, salmon, raw", 208, 20, 0, 13);
        await Assert.ThrowsAsync<ValidationException>(() => Plan().AddFoodsAsync(new AddPlanFoodsRequest(_store.Today, MealSlot.Dinner,
            [new FoodAmount(salmon.Id, 150, null, null), new FoodAmount(salmon.Id, null, 1, "cup")])));
        Assert.Empty(_store.Plan);
    }

    [Fact]
    public async Task No_amount_uses_a_standard_portion_as_an_assumption_or_asks()
    {
        _store.AddFood("Banana, raw", 89, 1.1, 23, 0.3, portions: new FoodPortion("medium", 118));
        _store.AddFood("Granola", 471, 10, 64, 20); // no portions at all

        var banana = (await Foods().MatchAsync("banana", "banana", null, null, null, 5, default)).Matches[0];
        Assert.Equal(QuantityStatus.Assumed, banana.Quantity.Status);
        Assert.Equal(118, banana.Quantity.Grams);

        var granola = (await Foods().MatchAsync("granola", "granola", null, null, null, 5, default)).Matches[0];
        Assert.Equal(QuantityStatus.NeedsAmount, granola.Quantity.Status);
        Assert.Null(granola.Quantity.Grams);   // never a made-up 100 g
        Assert.Null(granola.Nutrition);

        var given = (await Foods().MatchAsync("2 bananas", "banana", 2, null, null, 5, default)).Matches[0];
        Assert.Equal(QuantityStatus.Given, given.Quantity.Status);
        Assert.InRange(given.Confidence, 0, 1);
    }

    [Theory]
    [InlineData("I ate 2 eggs and toast", AssistantIntent.LogFood)]
    [InlineData("plan salmon and rice for friday dinner", AssistantIntent.PlanMeal)]
    [InlineData("what could I eat to hit my protein?", AssistantIntent.FillGaps)]
    [InlineData("what can I make with what I have", AssistantIntent.WhatCanIMake)]
    [InlineData("chicken soup recipes", AssistantIntent.FindRecipes)]
    [InlineData("I would really like a margarita pizza recipe", AssistantIntent.FindRecipes)]
    [InlineData("margherita pizza recipe", AssistantIntent.FindRecipes)]
    [InlineData("give me a pizza recipe", AssistantIntent.FindRecipes)]
    [InlineData("I ate pizza", AssistantIntent.LogFood)]
    [InlineData("I would really like a margarita", AssistantIntent.FindFood)]
    public void Intent_follows_what_you_said(string text, AssistantIntent intent) =>
        Assert.Equal(intent, Assistant.RuleBasedInterpreter.Interpret(text, new DateOnly(2026, 11, 21)).Intent);

    [Theory]
    [InlineData("I would really like a margarita pizza recipe", "margherita pizza")]
    [InlineData("margherita pizza recipe", "margherita pizza")]
    [InlineData("give me a pizza recipe", "pizza")]
    public void Recipe_requests_keep_only_the_dish_and_fix_margherita(string text, string query) =>
        Assert.Equal(query, Assistant.RuleBasedInterpreter.Interpret(text, new DateOnly(2026, 11, 21)).RecipeQuery);

    [Fact]
    public void Several_foods_in_one_sentence_become_separate_items()
    {
        var r = Assistant.RuleBasedInterpreter.Interpret("I had 2 eggs, a slice of toast and a black coffee for breakfast", new DateOnly(2026, 11, 21));
        Assert.Equal(3, r.Items.Count);
        Assert.Equal(2, r.Items[0].Amount);
        Assert.Equal(MealSlot.Breakfast, r.Meal);
    }
}
