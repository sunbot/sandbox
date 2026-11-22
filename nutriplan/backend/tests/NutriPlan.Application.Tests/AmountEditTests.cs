using NutriPlan.Application.Common;
using NutriPlan.Application.Diary;
using NutriPlan.Application.Planning;
using NutriPlan.Domain.Diary;
using NutriPlan.Domain.Foods;
using NutriPlan.Domain.Nutrients;
using NutriPlan.Domain.Planning;
using NutriPlan.Domain.Recipes;

namespace NutriPlan.Application.Tests;

/// <summary>Editing a logged or planned item's amount in another measure keeps quantity, unit, weight and nutrition consistent.</summary>
public class AmountEditTests
{
    private readonly InMemoryStore _store = new();
    private DiaryService Diary() => new(_store, _store, _store, _store, _store, _store);
    private PlanService Plan() => new(_store, _store, _store, Diary(), _store, _store);

    private Food Almonds() => _store.AddFood("Nuts, almonds", 579, 21, 22, 50, FoodSource.UsdaSrLegacy,
        new FoodPortion("cup, whole", 143), new FoodPortion("oz (23 whole kernels)", 28.35), new FoodPortion("almond", 1.2));

    private async Task<DiaryEntryDto> Log(Food f, double? grams = null, double? amount = null, string? unit = null) =>
        await Diary().LogFoodAsync(new LogFoodRequest(_store.Today, MealSlot.Snack, f.Id, grams, amount, unit));

    private DiaryEntry Entry(Guid id) => _store.Diary.Single(d => d.Id == id);

    [Fact]
    public async Task Grams_to_a_verified_count_updates_quantity_unit_weight_and_nutrition_together()
    {
        var f = Almonds();
        var logged = await Log(f, grams: 28);
        var updated = await Diary().UpdateAsync(logged.Id, null, null, null, null, default, amount: 12, unit: "almonds");

        Assert.Equal(12, updated.Item.Quantity);
        Assert.Equal("almond", updated.Item.Unit);
        Assert.Equal(14.4, updated.Item.Grams!.Value, 2);
        Assert.Equal(579 * 0.144, updated.Item.Nutrition.Calories, 0);
    }

    [Theory]
    [InlineData(1, "oz", 28.35)]
    [InlineData(2, "tbsp", 17.875)]   // from USDA's measured cup of almonds (143 g / 16)
    [InlineData(0.5, "cup", 71.5)]
    [InlineData(1.5, "g", 1.5)]
    public async Task Supported_measures_convert_from_the_foods_own_data(double amount, string unit, double grams)
    {
        var logged = await Log(Almonds(), grams: 100);
        var updated = await Diary().UpdateAsync(logged.Id, null, null, null, null, default, amount: amount, unit: unit);
        Assert.Equal(grams, updated.Item.Grams!.Value, 1);
        Assert.InRange(updated.Item.Nutrition.Calories, 579 * grams / 100 - 0.5, 579 * grams / 100 + 0.5); // weights are stored to 0.01 g
    }

    [Fact]
    public async Task A_measure_the_food_does_not_have_is_refused_with_the_reason_and_nothing_changes()
    {
        var chicken = _store.AddFood("Chicken breast, roasted", 165, 31, 0, 3.6, FoodSource.UsdaSrLegacy, new FoodPortion("breast, bone and skin removed", 172));
        var logged = await Log(chicken, grams: 150);
        var ex = await Assert.ThrowsAsync<ValidationException>(() => Diary().UpdateAsync(logged.Id, null, null, null, null, default, amount: 1, unit: "cup"));
        Assert.Contains("No volume measure", ex.Message);
        Assert.Equal(150, Entry(logged.Id).Item.Grams);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-2)]
    [InlineData(double.NaN)]
    public async Task Zero_negative_or_invalid_amounts_are_refused(double amount)
    {
        var logged = await Log(Almonds(), grams: 28);
        await Assert.ThrowsAsync<ValidationException>(() => Diary().UpdateAsync(logged.Id, null, null, null, null, default, amount: amount, unit: "g"));
        Assert.Equal(28, Entry(logged.Id).Item.Grams);
    }

    [Fact]
    public async Task A_misplaced_zero_is_caught()
    {
        var logged = await Log(Almonds(), grams: 28);
        await Assert.ThrowsAsync<ValidationException>(() => Diary().UpdateAsync(logged.Id, null, null, null, null, default, amount: 28000, unit: "g"));
    }

    [Fact]
    public async Task Editing_uses_the_nutrition_logged_at_the_time_not_the_foods_current_numbers()
    {
        var f = Almonds();
        var logged = await Log(f, grams: 100);
        f.UpdateNutrients(new NutrientProfile(new Dictionary<int, double> { [NutrientIds.Energy] = 999 })); // the food's data changes later
        var updated = await Diary().UpdateAsync(logged.Id, null, null, null, null, default, amount: 50, unit: "g");
        Assert.Equal(579 * 0.5, updated.Item.Nutrition.Calories, 0);
    }

    [Fact]
    public async Task Undo_by_changing_back_restores_the_original_amount_and_nutrition()
    {
        var logged = await Log(Almonds(), amount: 12, unit: "almond");
        var before = Entry(logged.Id).Item;
        await Diary().UpdateAsync(logged.Id, null, null, null, null, default, amount: 1, unit: "oz");
        var back = await Diary().UpdateAsync(logged.Id, null, null, null, null, default, amount: before.Quantity, unit: before.QuantityUnit);
        Assert.Equal(before.Quantity, back.Item.Quantity);
        Assert.Equal(before.QuantityUnit, back.Item.Unit);
        Assert.Equal(before.Nutrients.Calories, back.Item.Nutrition.Calories, 0);
    }

    [Fact]
    public async Task Amount_and_meal_change_together_and_the_planned_meal_link_is_kept()
    {
        var f = Almonds();
        var planned = await Plan().AddFoodAsync(new AddPlanFoodRequest(_store.Today, MealSlot.Snack, f.Id, 28, null, null));
        var logged = await Diary().LogFoodAsync(new LogFoodRequest(_store.Today, MealSlot.Snack, f.Id, 28, null, null, planned.Id));
        var updated = await Diary().UpdateAsync(logged.Id, null, null, MealSlot.Lunch, null, default, amount: 20, unit: "almond");
        Assert.Equal("Lunch", updated.Meal);
        Assert.Equal(planned.Id, updated.PlanEntryId);
        Assert.Equal(24, updated.Item.Grams!.Value, 2);
    }

    [Fact]
    public async Task A_drink_measured_by_volume_changes_between_volume_measures_and_never_gets_a_weight()
    {
        var shake = new Food("Protein shake", FoodSource.UsdaBranded, new NutrientProfile(new Dictionary<int, double> { [NutrientIds.Energy] = 60 }),
            portions: [new FoodPortion("bottle", 340)], basis: NutrientBasis.Volume);
        _store.Foods.Add(shake);
        var logged = await Log(shake, amount: 1, unit: "bottle"); // 340 ml
        var updated = await Diary().UpdateAsync(logged.Id, null, null, null, null, default, amount: 1, unit: "cup");
        Assert.Null(updated.Item.Grams);
        Assert.Equal("cup", updated.Item.Unit);
        Assert.Equal(60 * 2.365882, updated.Item.Nutrition.Calories, 0);
        await Assert.ThrowsAsync<ValidationException>(() => Diary().UpdateAsync(logged.Id, null, null, null, null, default, amount: 100, unit: "g"));
    }

    [Fact]
    public async Task Recipes_change_by_servings_and_quick_entries_have_no_amount()
    {
        var recipe = new Recipe("Soup", 4);
        recipe.ApplyNutrition(new RecipeNutrition(NutrientProfile.Empty, new NutrientProfile(new Dictionary<int, double> { [NutrientIds.Energy] = 200 }), 1, []));
        _store.Recipes.Add(recipe);
        var logged = await Diary().LogRecipeAsync(new LogRecipeRequest(_store.Today, MealSlot.Lunch, recipe.Id, 1));
        var updated = await Diary().UpdateAsync(logged.Id, null, null, null, null, default, amount: 1.5, unit: "servings");
        Assert.Equal((1.5, "servings", 300.0), (updated.Item.Quantity, updated.Item.Unit, updated.Item.Nutrition.Calories));
        await Assert.ThrowsAsync<ValidationException>(() => Diary().UpdateAsync(logged.Id, null, null, null, null, default, amount: 1, unit: "cup"));

        var quick = await Diary().LogQuickAsync(new LogQuickRequest(_store.Today, MealSlot.Snack, "Cookie", 150, null, null, null));
        await Assert.ThrowsAsync<ValidationException>(() => Diary().UpdateAsync(quick.Id, null, null, null, null, default, amount: 2, unit: null));
    }

    [Fact]
    public async Task If_the_food_is_gone_only_the_amount_in_its_own_unit_can_change()
    {
        var f = Almonds();
        var logged = await Log(f, amount: 10, unit: "almond");
        _store.Foods.Remove(f);
        var same = await Diary().UpdateAsync(logged.Id, null, null, null, null, default, amount: 20, unit: "almond");
        Assert.Equal(24, same.Item.Grams!.Value, 2);
        await Assert.ThrowsAsync<ValidationException>(() => Diary().UpdateAsync(logged.Id, null, null, null, null, default, amount: 1, unit: "oz"));
    }

    [Fact]
    public async Task Planned_items_change_amount_the_same_way_but_not_once_eaten()
    {
        var f = Almonds();
        var planned = await Plan().AddFoodAsync(new AddPlanFoodRequest(_store.Today, MealSlot.Snack, f.Id, 28, null, null));
        var updated = await Plan().SetAmountAsync(planned.Id, 1, "cup");
        Assert.Equal((1.0, "cup", 143.0), (updated.Item.Quantity, updated.Item.Unit, updated.Item.Grams!.Value));

        await Plan().MarkEatenAsync(planned.Id, 1, _store.Today);
        await Assert.ThrowsAsync<ValidationException>(() => Plan().SetAmountAsync(planned.Id, 2, "cup"));
    }

    [Fact]
    public async Task Sending_both_a_scale_and_an_amount_is_refused()
    {
        var logged = await Log(Almonds(), grams: 28);
        await Assert.ThrowsAsync<ValidationException>(() => Diary().UpdateAsync(logged.Id, 2, null, null, null, default, amount: 1, unit: "oz"));
    }

    [Fact]
    public async Task Logging_with_an_amount_and_unit_keeps_the_chosen_measure()
    {
        var logged = await Log(Almonds(), amount: 12, unit: "almond");
        Assert.Equal((12.0, "almond"), (logged.Item.Quantity, logged.Item.Unit));
        Assert.Equal(14.4, logged.Item.Grams!.Value, 6);
    }
}
