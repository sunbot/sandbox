using NutriPlan.Application.Abstractions;
using NutriPlan.Application.Common;
using NutriPlan.Application.Diary;
using NutriPlan.Application.Foods;
using NutriPlan.Domain.Diary;
using NutriPlan.Domain.Foods;
using NutriPlan.Domain.Units;

namespace NutriPlan.Application.Tests;

/// <summary>Logging and editing in renamed or borrowed USDA measures, and the small search boost for measured foods.</summary>
public class UsdaMeasureTests
{
    private readonly InMemoryStore _store = new();
    private DiaryService Diary() => new(_store, _store, _store, _store, _store, _store);

    private Food AlmondsNfs() => _store.AddFood("Almonds, NFS", 598, 21, 21, 51, FoodSource.UsdaSurvey,
        new FoodPortion("100 calorie package", 18), new FoodPortion("nut", 1.2), new FoodPortion("package", 50), new FoodPortion("oz", 28.35), new FoodPortion("cup", 141));

    private async Task<DiaryEntryDto> Log(Food f, double? grams = null, double? amount = null, string? unit = null) =>
        await Diary().LogFoodAsync(new LogFoodRequest(_store.Today, MealSlot.Snack, f.Id, grams, amount, unit));

    [Fact]
    public async Task Logging_in_the_renamed_package_stores_that_name_and_its_weight()
    {
        var f = AlmondsNfs();
        var logged = await Log(f, amount: 2, unit: "100-calorie package");
        Assert.Equal("100-calorie package", logged.Item.Unit);
        Assert.Equal(36, logged.Item.Grams!.Value, 2);
        Assert.Equal(598 * 0.36, logged.Item.Nutrition.Calories, 0);
        Assert.Contains(FoodSummaryDto.From(f).Measures!, m => m.Unit == logged.Item.Unit); // the app finds the entry's measure again
    }

    [Fact]
    public async Task Switching_between_package_count_and_weight_round_trips_exactly()
    {
        var f = AlmondsNfs();
        var logged = await Log(f, amount: 1, unit: "100-calorie package");
        var nuts = await Diary().UpdateAsync(logged.Id, null, null, null, null, default, amount: 15, unit: "nut");
        Assert.Equal(18, nuts.Item.Grams!.Value, 2);
        var grams = await Diary().UpdateAsync(logged.Id, null, null, null, null, default, amount: 18, unit: "g");
        Assert.Equal(18, grams.Item.Grams!.Value, 2);
        var back = await Diary().UpdateAsync(logged.Id, null, null, null, null, default, amount: 1, unit: "100-calorie package");
        Assert.Equal("100-calorie package", back.Item.Unit);
        Assert.Equal(logged.Item.Nutrition.Calories, back.Item.Nutrition.Calories, 6);
        var two = await Diary().UpdateAsync(logged.Id, null, null, null, null, default, amount: 2, unit: "100-calorie packages");
        Assert.Equal(36, two.Item.Grams!.Value, 2); // same unit, plural: ratio of amounts
        Assert.InRange(two.Item.Nutrition.Calories, 2 * logged.Item.Nutrition.Calories - 0.15, 2 * logged.Item.Nutrition.Calories + 0.15); // shown to 0.1 kcal
    }

    [Fact]
    public async Task An_entry_logged_as_calorie_before_the_rename_keeps_its_weight_and_can_still_change()
    {
        var f = AlmondsNfs();
        var old = await Log(f, amount: 1, unit: "calorie");
        Assert.Equal(18, old.Item.Grams!.Value, 2);
        var doubled = await Diary().UpdateAsync(old.Id, null, null, null, null, default, amount: 2, unit: "calorie");
        Assert.Equal(36, doubled.Item.Grams!.Value, 2);
        var renamed = await Diary().UpdateAsync(old.Id, null, null, null, null, default, amount: 1, unit: "100-calorie package");
        Assert.Equal(18, renamed.Item.Grams!.Value, 2);
    }

    [Fact]
    public async Task Borrowing_portions_later_never_changes_what_was_already_logged()
    {
        var raw = _store.AddFood("Nuts, almonds, whole, raw", 584, 21, 20, 51, FoodSource.UsdaFoundation);
        var logged = await Log(raw, grams: 28);
        var before = _store.Diary.Single(d => d.Id == logged.Id).Item;

        raw.ReplacePortions(EquivalentPortions.Borrowable(raw.Name, "Nuts, almonds",
            [new FoodPortion("cup, whole", 143), new FoodPortion("cup, sliced", 92), new FoodPortion("almond", 1.2)], "USDA SR Legacy 170567"));

        var after = _store.Diary.Single(d => d.Id == logged.Id).Item;
        Assert.Equal(before.Grams, after.Grams);
        Assert.Equal(before.Nutrients.Calories, after.Nutrients.Calories);
        Assert.Equal(584, raw.NutrientsPer100g.Calories); // the food's own nutrition is untouched

        var count = await Diary().UpdateAsync(logged.Id, null, null, null, null, default, amount: 20, unit: "almonds");
        Assert.Equal(24, count.Item.Grams!.Value, 2);
        Assert.Equal(584 * 0.24, count.Item.Nutrition.Calories, 0);
        var measures = FoodSummaryDto.From(raw).Measures!;
        Assert.Equal("USDA SR Legacy 170567", measures.Single(m => m.Unit == "almond").Origin);
        Assert.Equal(143, measures.Single(m => m.Unit == "cup").Base, 3);
    }

    // ── Search ───────────────────────────────────────────────────────────────

    private static FoodSearchRow Row(string name, FoodSource source, int logged = 0, params FoodPortion[] portions) =>
        new(new Food(name, source, new Domain.Nutrients.NutrientProfile(new Dictionary<int, double> { [1008] = 580 }), portions: portions), 0.5, logged);

    [Fact]
    public void Among_equally_relevant_matches_the_one_you_can_measure_ranks_first()
    {
        var bare = Row("Almonds, raw", FoodSource.UsdaFoundation);
        var measured = Row("Almonds, raw", FoodSource.UsdaFoundation, 0, new FoodPortion("almond", 1.2), new FoodPortion("cup, whole", 143));
        Assert.Same(measured.Food, FoodRanker.Rank("almonds", [bare, measured])[0].Food);
        Assert.Same(measured.Food, FoodRanker.Rank("almonds", [measured, bare])[0].Food);
        Assert.False(FoodRanker.HasMeasuredPortion(Row("Almonds", FoodSource.UsdaSrLegacy, 0, new FoodPortion("oz", 28.35), new FoodPortion("oz, NFS", 28.35)).Food)); // weights only
    }

    [Fact]
    public void Measures_never_outweigh_the_requested_state_or_your_history()
    {
        var raw = Row("Chicken, breast, boneless, skinless, raw", FoodSource.UsdaFoundation);
        var roasted = Row("Chicken, breast, boneless, skinless, roasted", FoodSource.UsdaFoundation, 0, new FoodPortion("breast", 172), new FoodPortion("cup, chopped", 140));
        Assert.Same(raw.Food, FoodRanker.Rank("chicken breast", [roasted, raw])[0].Food);
        Assert.Same(roasted.Food, FoodRanker.Rank("chicken breast roasted", [roasted, raw])[0].Food);

        var usual = Row("Almonds, raw", FoodSource.UsdaFoundation, logged: 6);
        var measured = Row("Almonds, raw", FoodSource.UsdaFoundation, 0, new FoodPortion("almond", 1.2));
        Assert.Same(usual.Food, FoodRanker.Rank("almonds", [measured, usual])[0].Food);
    }
}
