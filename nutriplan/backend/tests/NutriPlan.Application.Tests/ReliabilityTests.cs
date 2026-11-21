using NutriPlan.Application.Abstractions;
using NutriPlan.Application.Assistant;
using NutriPlan.Application.Common;
using NutriPlan.Application.Diary;
using NutriPlan.Application.Foods;
using NutriPlan.Application.Planning;
using NutriPlan.Domain.Diary;
using NutriPlan.Domain.Foods;
using NutriPlan.Domain.Planning;

namespace NutriPlan.Application.Tests;

/// <summary>Regression tests for the reliability review: Ask parsing, quantity resolution, raw/cooked, plan/diary integrity.</summary>
public class ReliabilityTests
{
    private static readonly DateOnly Sat = new(2026, 11, 21);
    private readonly InMemoryStore _store = new();
    private DiaryService Diary() => new(_store, _store, _store, _store, _store, _store);
    private PlanService Plan() => new(_store, _store, _store, Diary(), _store, _store);
    private FoodService Foods() => new(_store, [], _store);

    // ---- Ask: segmentation and meals -------------------------------------------------------------------------

    [Fact]
    public void Spoken_list_without_commas_or_conjunctions_becomes_three_foods_and_no_invented_meal()
    {
        var r = RuleBasedInterpreter.Interpret("I had two pieces of toast two scrambled eggs and a cup of coffee", Sat);
        Assert.Equal(3, r.Items.Count);
        Assert.Equal(2, r.Items[0].Amount);
        Assert.Contains("toast", r.Items[0].FoodQuery);
        Assert.Equal(2, r.Items[1].Amount);
        Assert.Contains("scrambled eggs", r.Items[1].FoodQuery);
        Assert.Equal(1, r.Items[2].Amount);
        Assert.Equal("cup", r.Items[2].Unit);
        Assert.Contains("coffee", r.Items[2].FoodQuery);
        Assert.Null(r.Meal); // no meal was said, so none is guessed by the interpreter (the app applies a default the user can change)
    }

    [Theory]
    [InlineData("2 eggs and toast for breakfast", MealSlot.Breakfast)]
    [InlineData("I had a salad at lunch", MealSlot.Lunch)]
    [InlineData("dinner: 150 g salmon", MealSlot.Dinner)]
    [InlineData("an apple as a snack", MealSlot.Snack)]
    public void Only_an_explicit_meal_reference_sets_the_meal(string text, MealSlot meal) =>
        Assert.Equal(meal, RuleBasedInterpreter.Interpret(text, Sat).Meal);

    [Theory]
    [InlineData("I ate 2 eggs")]
    [InlineData("a banana and a coffee")]
    [InlineData("chicken breast 4 oz")]
    public void No_meal_word_means_no_meal(string text) =>
        Assert.Null(RuleBasedInterpreter.Interpret(text, Sat).Meal);

    [Theory]
    [InlineData("4 oz of chicken breast", 4, "oz", "chicken breast")]
    [InlineData("chicken breast 4 oz", 4, "oz", "chicken breast")]
    [InlineData("chicken breast 4oz", 4, "oz", "chicken breast")]
    [InlineData("half a pound of raw chicken", 0.5, "pound", "chicken")]
    [InlineData("100 g cooked chicken", 100, "g", "cooked chicken")]
    [InlineData("2 slices of toast", 2, "slices", "toast")]
    [InlineData("1 cup coffee", 1, "cup", "coffee")]
    public void Quantity_and_unit_survive_parsing(string text, double amount, string unit, string food)
    {
        var item = Assert.Single(RuleBasedInterpreter.Interpret(text, Sat).Items);
        Assert.Equal(amount, item.Amount);
        Assert.Equal(unit, item.Unit);
        Assert.Contains(food, item.FoodQuery);
    }

    [Fact]
    public void Repeated_quantities_stay_separate_foods()
    {
        var r = RuleBasedInterpreter.Interpret("2 eggs 2 slices of toast 1 cup of coffee 3 strips of bacon", Sat);
        Assert.Equal(4, r.Items.Count);
        Assert.Equal([2d, 2d, 1d, 3d], r.Items.Select(i => i.Amount!.Value));
    }

    [Fact]
    public void Mixed_units_each_keep_their_own()
    {
        var r = RuleBasedInterpreter.Interpret("200 g rice, 1 tbsp olive oil and half a cup of beans", Sat);
        Assert.Equal(["g", "tbsp", "cup"], r.Items.Select(i => i.Unit!));
        Assert.Equal(0.5, r.Items[2].Amount);
    }

    [Fact]
    public void Number_words_larger_than_twelve_are_understood()
    {
        var item = Assert.Single(RuleBasedInterpreter.Interpret("I ate twenty almonds", Sat).Items);
        Assert.Equal(20, item.Amount);
    }

    // ---- ItemNormalizer: protects the Claude path too --------------------------------------------------------

    [Fact]
    public void A_merged_item_from_the_model_is_split_back_into_foods()
    {
        var merged = new InterpretedItem("2 slices of toast 2 scrambled eggs", null, null, null, null, null);
        var result = ItemNormalizer.Normalize([merged]);
        Assert.Equal(2, result.Count);
        Assert.Equal(2, result[0].Amount);
        Assert.Equal(2, result[1].Amount);
    }

    [Fact]
    public void A_quantity_left_in_the_food_text_by_the_model_is_recovered()
    {
        var item = Assert.Single(ItemNormalizer.Normalize([new InterpretedItem("4 oz chicken breast", null, null, null, null, null)]));
        Assert.Equal(4, item.Amount);
        Assert.Equal("oz", item.Unit);
        Assert.DoesNotContain("4", item.FoodQuery);
    }

    [Fact]
    public void A_state_the_model_reports_is_kept_in_the_search_text()
    {
        var item = Assert.Single(ItemNormalizer.Normalize([new InterpretedItem("chicken breast", 100, "g", null, null, "cooked")]));
        Assert.Contains("cooked", item.FoodQuery, StringComparison.OrdinalIgnoreCase);
        Assert.Equal(100, item.Amount);
    }

    [Fact]
    public void Items_that_are_already_right_pass_through_unchanged()
    {
        var item = new InterpretedItem("chicken breast", 4, "oz", null, null, null);
        Assert.Equal(item, Assert.Single(ItemNormalizer.Normalize([item])));
    }

    // ---- Quantities: mass is exact, volume needs the food's own measure --------------------------------------

    [Fact]
    public async Task Four_ounces_of_chicken_breast_is_matched_and_converted_without_asking()
    {
        _store.AddFood("Chicken, broilers or fryers, breast, meat only, raw", 120, 22.5, 0, 2.6);
        var m = (await Foods().MatchAsync("4 oz chicken breast", "chicken breast", 4, "oz", null, 5, default)).Matches[0];
        Assert.Equal(QuantityStatus.Given, m.Quantity.Status);
        Assert.Equal(113.4, m.Quantity.Grams!.Value, 1);
        Assert.NotNull(m.Nutrition);
        Assert.Equal(120 * 1.134, m.Nutrition!.Calories, 0);
    }

    [Fact]
    public async Task Half_a_pound_converts_by_mass_alone()
    {
        _store.AddFood("Chicken, broilers or fryers, breast, meat only, raw", 120, 22.5, 0, 2.6);
        var m = (await Foods().MatchAsync("half a pound of raw chicken breast", "raw chicken breast", 0.5, "pound", null, 5, default)).Matches[0];
        Assert.Equal(226.8, m.Quantity.Grams!.Value, 1);
    }

    [Fact]
    public async Task A_cup_of_a_food_with_no_cup_measure_is_not_invented()
    {
        _store.AddFood("Chicken breast, raw", 120, 22.5, 0, 2.6); // no portions
        var m = (await Foods().MatchAsync("1 cup chicken breast", "chicken breast", 1, "cup", null, 5, default)).Matches[0];
        Assert.Null(m.Quantity.Grams);
        Assert.Null(m.Nutrition);
        Assert.NotEqual(QuantityStatus.Given, m.Quantity.Status);
    }

    [Fact]
    public async Task A_cup_uses_the_foods_own_cup_measure()
    {
        _store.AddFood("Coffee, brewed", 1, 0.1, 0, 0, portions: new FoodPortion("cup", 237));
        var m = (await Foods().MatchAsync("1 cup coffee", "coffee", 1, "cup", null, 5, default)).Matches[0];
        Assert.Equal(237, m.Quantity.Grams!.Value, 0);
        Assert.Equal(QuantityStatus.Given, m.Quantity.Status);
    }

    [Fact]
    public async Task Two_pieces_of_toast_use_the_slice_portion_and_are_labelled_assumed()
    {
        _store.AddFood("Bread, whole wheat, toasted", 293, 9, 54, 4, portions: new FoodPortion("slice", 33));
        var m = (await Foods().MatchAsync("2 pieces of toast", "toast", 2, "pieces", null, 5, default)).Matches[0];
        Assert.Equal(66, m.Quantity.Grams!.Value, 0);
        Assert.Equal(QuantityStatus.Assumed, m.Quantity.Status);
    }

    [Fact]
    public async Task Two_scrambled_eggs_are_two_eggs_not_a_gram_guess()
    {
        _store.AddFood("Egg, whole, cooked, scrambled", 149, 10, 1.6, 11, portions: new FoodPortion("large", 61));
        var m = (await Foods().MatchAsync("2 scrambled eggs", "scrambled eggs", 2, null, null, 5, default)).Matches[0];
        Assert.Equal(122, m.Quantity.Grams!.Value, 0);
    }

    // ---- Raw vs cooked ---------------------------------------------------------------------------------------

    [Fact]
    public async Task A_requested_cooked_state_beats_a_raw_entry_and_the_reverse()
    {
        _store.AddFood("Chicken breast, raw", 120, 22.5, 0, 2.6);
        _store.AddFood("Chicken breast, cooked, roasted", 165, 31, 0, 3.6);
        var cooked = (await Foods().MatchAsync("100 g cooked chicken breast", "cooked chicken breast", 100, "g", null, 5, default)).Matches[0];
        var raw = (await Foods().MatchAsync("100 g raw chicken breast", "raw chicken breast", 100, "g", null, 5, default)).Matches[0];
        Assert.Contains("cooked", cooked.Food.Name);
        Assert.Contains("raw", raw.Food.Name);
        Assert.NotEqual(cooked.Nutrition!.Calories, raw.Nutrition!.Calories); // never silently converted between states
    }

    [Fact]
    public async Task Cooked_staples_are_the_default_when_eating_and_the_assumption_is_stated()
    {
        _store.AddFood("Rice, white, raw", 365, 7, 80, 0.7);
        _store.AddFood("Rice, white, cooked", 130, 2.7, 28, 0.3, portions: new FoodPortion("cup", 158));
        var m = (await Foods().MatchAsync("1 cup rice", "rice", 1, "cup", null, 5, default)).Matches[0];
        Assert.Contains("cooked", m.Food.Name);
        Assert.NotNull(m.Preparation);
        Assert.Equal("Cooked", m.Preparation!.State);
        Assert.Contains("Assumed cooked", m.Preparation.Note);
    }

    [Fact]
    public async Task Dry_rice_stays_dry()
    {
        _store.AddFood("Rice, white, raw", 365, 7, 80, 0.7, portions: new FoodPortion("cup", 185));
        _store.AddFood("Rice, white, cooked", 130, 2.7, 28, 0.3, portions: new FoodPortion("cup", 158));
        var m = (await Foods().MatchAsync("1 cup dry rice", "dry rice", 1, "cup", null, 5, default)).Matches[0];
        Assert.Contains("raw", m.Food.Name);
    }

    [Fact]
    public async Task A_raw_match_offers_the_cooked_counterpart_when_cooking_matters()
    {
        _store.AddFood("Chicken breast, raw", 120, 22.5, 0, 2.6);
        _store.AddFood("Chicken breast, cooked, roasted", 165, 31, 0, 3.6);
        var m = (await Foods().MatchAsync("4 oz chicken breast", "chicken breast", 4, "oz", null, 5, default)).Matches[0];
        Assert.Equal("Raw", m.Preparation!.State);
        Assert.NotNull(m.Preparation.OtherFoodId);
        Assert.Contains("cooked", m.Preparation.Note, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Fruit_gets_no_raw_or_cooked_prompt()
    {
        _store.AddFood("Banana, raw", 89, 1.1, 23, 0.3, portions: new FoodPortion("medium", 118));
        _store.AddFood("Banana, dehydrated, or banana powder", 346, 3.9, 88, 1.8);
        var m = (await Foods().MatchAsync("a banana", "banana", 1, null, null, 5, default)).Matches[0];
        Assert.Null(m.Preparation?.Note);
    }

    [Fact]
    public async Task Recipe_ingredient_matching_does_not_assume_cooked_staples()
    {
        _store.AddFood("Rice, white, raw", 365, 7, 80, 0.7);
        _store.AddFood("Rice, white, cooked", 130, 2.7, 28, 0.3);
        var ranked = await Foods().SearchRankedAsync("rice", 5, default, useHistory: false, assumeCookedStaples: false);
        Assert.Contains("raw", ranked[0].Food.Name);
    }

    // ---- Interpreter diagnostics -----------------------------------------------------------------------------

    private sealed class ThrowingInterpreter : ILanguageInterpreter
    {
        public bool IsAvailable => true;
        public Task<InterpretedRequest> InterpretAsync(string text, DateOnly today, CancellationToken ct = default) => throw new HttpRequestException("secret-looking detail sk-test-123");
    }

    private sealed class FakeClaude(InterpretedRequest result) : ILanguageInterpreter
    {
        public bool IsAvailable => true;
        public Task<InterpretedRequest> InterpretAsync(string text, DateOnly today, CancellationToken ct = default) => Task.FromResult(result);
    }

    [Fact]
    public async Task The_response_says_rules_handled_it_when_claude_is_off()
    {
        _store.AddFood("Egg, whole, raw", 143, 12.6, 0.7, 9.5, portions: new FoodPortion("large", 50));
        var r = await Assistant(null).HandleAsync(new AssistantRequest("2 eggs", Sat));
        Assert.Equal("Rules", r.Interpreter);
        Assert.False(r.UsedLanguageModel);
    }

    [Fact]
    public async Task A_failing_claude_falls_back_to_rules_and_leaks_no_detail()
    {
        _store.AddFood("Egg, whole, raw", 143, 12.6, 0.7, 9.5, portions: new FoodPortion("large", 50));
        var r = await Assistant(new ThrowingInterpreter()).HandleAsync(new AssistantRequest("2 eggs", Sat));
        Assert.Equal("RulesFallback", r.Interpreter);
        Assert.Single(r.FoodMatches);
        Assert.DoesNotContain("sk-", r.InterpreterNote);
        Assert.DoesNotContain("secret", r.InterpreterNote);
    }

    [Fact]
    public async Task Claude_output_still_gets_its_numbers_from_the_database()
    {
        _store.AddFood("Egg, whole, raw", 143, 12.6, 0.7, 9.5, portions: new FoodPortion("large", 50));
        var claude = new FakeClaude(new InterpretedRequest(AssistantIntent.LogFood, [new InterpretedItem("eggs", 2, "large", null, null, null)], null, null, null, null, null));
        var r = await Assistant(claude).HandleAsync(new AssistantRequest("two eggs", Sat));
        Assert.Equal("Claude", r.Interpreter);
        Assert.Equal(143, r.FoodMatches[0].Matches[0].Food.Per100g.Calories); // per-100 g straight from the stored food
        Assert.Equal(100, r.FoodMatches[0].Matches[0].Quantity.Grams!.Value, 0);
    }

    private sealed class NoIdeas : IRecipeIdeaGenerator
    {
        public bool IsAvailable => false;
        public Task<IReadOnlyList<RecipeIdea>> GenerateAsync(string request, int count, string? constraints, CancellationToken ct = default) => Task.FromResult<IReadOnlyList<RecipeIdea>>([]);
    }

    private sealed class NoWeb : IWebPageFetcher
    {
        public Task<string> GetHtmlAsync(Uri url, CancellationToken ct = default) => throw new NotSupportedException();
    }

    private AssistantService Assistant(ILanguageInterpreter? lm)
    {
        var foods = Foods();
        return new AssistantService(lm ?? new Unavailable(), new NoIdeas(), foods, new Recipes.RecipeService(_store, _store, foods, new NoWeb(), _store),
            new Pantry.PantryService(_store, _store, _store, _store), new GapFillService(_store, _store, _store, _store, _store, _store, foods),
            _store, Microsoft.Extensions.Logging.Abstractions.NullLogger<AssistantService>.Instance);
    }

    private sealed class Unavailable : ILanguageInterpreter
    {
        public bool IsAvailable => false;
        public Task<InterpretedRequest> InterpretAsync(string text, DateOnly today, CancellationToken ct = default) => throw new InvalidOperationException();
    }

    // ---- Plan / diary transitions ----------------------------------------------------------------------------

    private async Task<(Food Oats, PlanEntryDto Planned)> PlanOats(DateOnly? date = null)
    {
        var oats = _store.AddFood("Oats", 379, 13, 68, 6.5);
        var planned = await Plan().AddFoodAsync(new AddPlanFoodRequest(date ?? _store.Today, MealSlot.Dinner, oats.Id, 100, null, null));
        return (oats, planned);
    }

    [Fact]
    public async Task Planned_food_never_counts_as_eaten()
    {
        await PlanOats();
        var day = await Diary().GetDayAsync(_store.Today);
        var today = (await Plan().GetWeekAsync(_store.Today)).Days.Single(d => d.IsToday);
        Assert.Equal(0, day.Totals.Calories);
        Assert.Equal(0, today.Eaten.Calories);
        Assert.Equal(379, today.PlannedRemaining.Calories, 0);
    }

    [Fact]
    public async Task Marking_eaten_logs_once_with_a_link_and_a_second_attempt_is_refused()
    {
        var (_, planned) = await PlanOats();
        var logged = await Plan().MarkEatenAsync(planned.Id);
        Assert.Equal(planned.Id, logged.PlanEntryId);
        await Assert.ThrowsAsync<ValidationException>(() => Plan().MarkEatenAsync(planned.Id));
        Assert.Single(_store.Diary);
        Assert.Equal(379, (await Diary().GetDayAsync(_store.Today)).Totals.Calories, 0);
    }

    [Fact]
    public async Task Marking_eaten_with_a_scale_logs_the_scaled_amount()
    {
        var (_, planned) = await PlanOats();
        var logged = await Plan().MarkEatenAsync(planned.Id, 0.5);
        Assert.Equal(50, logged.Item.Grams!.Value, 1);
        Assert.Equal(190, (await Diary().GetDayAsync(_store.Today)).Totals.Calories, 0);
    }

    [Fact]
    public async Task An_eaten_plan_entry_with_no_diary_entry_is_shown_and_counted_as_planned_not_logged()
    {
        // The state found in production: a deleted log left its plan entry marked Eaten (the old delete didn't reopen it).
        var (_, planned) = await PlanOats();
        _store.Plan.Single().MarkEaten();

        var week = await Plan().GetWeekAsync(_store.Today);
        var today = week.Days.Single(d => d.IsToday);
        Assert.Equal(0, today.Eaten.Calories);
        Assert.Equal("Planned", today.Planned.Single().Status);
        Assert.Equal(week.EatenSoFar, (await Diary().GetDayAsync(_store.Today)).Totals.Calories);
        Assert.Equal(PlanStatus.Planned, _store.Plan.Single().Status); // repaired in memory; reads never write
    }

    [Fact]
    public async Task Today_and_Week_agree_after_every_mutation()
    {
        var (oats, planned) = await PlanOats();
        async Task AssertAgree()
        {
            var day = await Diary().GetDayAsync(_store.Today);
            var week = (await Plan().GetWeekAsync(_store.Today)).Days.Single(d => d.IsToday);
            Assert.Equal(day.Totals.Calories, week.Eaten.Calories, 6);
        }
        await AssertAgree();
        var logged = await Plan().MarkEatenAsync(planned.Id);
        await AssertAgree();
        await Diary().UpdateAsync(logged.Id, 2, null, null, null);
        await AssertAgree();
        await Diary().DeleteAsync(logged.Id);
        await AssertAgree();
        Assert.Equal(PlanStatus.Planned, _store.Plan.Single().Status);
        await Plan().MarkSkippedAsync(planned.Id);
        await AssertAgree();
        await Plan().ReopenAsync(planned.Id);
        await Plan().DeleteAsync(planned.Id);
        await AssertAgree();
        await Diary().LogFoodAsync(new LogFoodRequest(_store.Today, MealSlot.Lunch, oats.Id, 50, null, null));
        await AssertAgree();
    }

    [Fact]
    public async Task Skipping_removes_the_meal_from_remaining_and_never_from_the_diary()
    {
        var (_, planned) = await PlanOats();
        await Plan().MarkSkippedAsync(planned.Id);
        var today = (await Plan().GetWeekAsync(_store.Today)).Days.Single(d => d.IsToday);
        Assert.Equal(0, today.PlannedRemaining.Calories);
        Assert.Equal(0, today.Eaten.Calories);
        Assert.Empty(_store.Diary);
    }

    [Fact]
    public async Task Editing_a_logged_meal_changes_totals_but_the_plan_entry_stays_eaten()
    {
        var (_, planned) = await PlanOats();
        var logged = await Plan().MarkEatenAsync(planned.Id);
        await Diary().UpdateAsync(logged.Id, 1.5, null, MealSlot.Lunch, null);
        Assert.Equal(379 * 1.5, (await Diary().GetDayAsync(_store.Today)).Totals.Calories, 0);
        Assert.Equal(PlanStatus.Eaten, _store.Plan.Single().Status);
    }

    [Fact]
    public async Task A_log_from_a_nearby_time_zone_is_allowed_a_day_ahead_but_not_two()
    {
        var (_, tomorrow) = await PlanOats(_store.Today.AddDays(1));
        await Plan().MarkEatenAsync(tomorrow.Id);                         // server is a day behind the device: allowed
        var (_, later) = await PlanOats(_store.Today.AddDays(3));
        await Assert.ThrowsAsync<ValidationException>(() => Plan().MarkEatenAsync(later.Id));
    }

    [Fact]
    public async Task The_week_uses_the_device_date_for_today()
    {
        await PlanOats();
        var week = await Plan().GetWeekAsync(_store.Today, _store.Today.AddDays(1));
        Assert.True(week.Days.Single(d => d.Date == _store.Today.AddDays(1)).IsToday);
    }

    // ---- Idempotent submits ----------------------------------------------------------------------------------

    [Fact]
    public async Task A_repeated_log_all_with_the_same_key_saves_once()
    {
        var egg = _store.AddFood("Egg, whole, raw", 143, 12.6, 0.7, 9.5);
        var once = new IdempotencyStore();
        var request = new LogFoodsRequest(_store.Today, MealSlot.Breakfast, [new FoodAmount(egg.Id, 100, null, null)]);
        var a = await once.RunAsync("k1", request, () => Diary().LogFoodsAsync(request));
        var b = await once.RunAsync("k1", request, () => Diary().LogFoodsAsync(request));
        Assert.Same(a, b);
        Assert.Single(_store.Diary);
    }

    [Fact]
    public async Task A_different_body_or_key_is_a_new_request_and_failures_are_not_remembered()
    {
        var egg = _store.AddFood("Egg, whole, raw", 143, 12.6, 0.7, 9.5);
        var once = new IdempotencyStore();
        var one = new LogFoodsRequest(_store.Today, MealSlot.Breakfast, [new FoodAmount(egg.Id, 100, null, null)]);
        var two = one with { Items = [new FoodAmount(egg.Id, 50, null, null)] };
        await once.RunAsync("k", one, () => Diary().LogFoodsAsync(one));
        await once.RunAsync("k", two, () => Diary().LogFoodsAsync(two));
        await once.RunAsync("other", one, () => Diary().LogFoodsAsync(one));
        Assert.Equal(3, _store.Diary.Count);

        var attempts = 0;
        Task<List<int>> Flaky() => ++attempts == 1 ? throw new InvalidOperationException() : Task.FromResult(new List<int> { 1 });
        await Assert.ThrowsAsync<InvalidOperationException>(() => once.RunAsync("f", new { }, Flaky));
        Assert.Single(await once.RunAsync("f", new { }, Flaky));
    }

    [Fact]
    public async Task Without_a_key_nothing_is_deduplicated()
    {
        var once = new IdempotencyStore();
        var n = 0;
        await once.RunAsync<object>(null, new { }, () => Task.FromResult<object>(++n));
        await once.RunAsync<object>(null, new { }, () => Task.FromResult<object>(++n));
        Assert.Equal(2, n);
    }
}

public class OrganMeatRankingTests
{
    [Fact]
    public async Task Plain_chicken_is_never_the_giblets()
    {
        var store = new InMemoryStore();
        store.AddFood("Chicken, capons, giblets, raw", 139, 22, 0, 4.6);
        store.AddFood("Chicken, broilers or fryers, breast, meat only, raw", 120, 22.5, 0, 2.6);
        var top = (await new FoodService(store, [], store).MatchAsync("raw chicken", "raw chicken", null, null, null, 5, default)).Matches[0];
        Assert.DoesNotContain("giblets", top.Food.Name);
    }
}
