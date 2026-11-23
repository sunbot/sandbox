using NutriPlan.Application.Planning;
using NutriPlan.Domain.Diary;
using NutriPlan.Domain.Grocery;
using NutriPlan.Domain.Planning;
using NutriPlan.Domain.Recipes;

namespace NutriPlan.Application.Tests;

public class GroceryExclusionTests
{
    private readonly InMemoryStore _store = new();

    private GroceryService Grocery() => new(_store, _store, _store, _store, _store, _store);
    private GroceryExclusionService Exclusions() => new(_store, _store);
    private PlanService Plan() => new(_store, _store, _store, new Diary.DiaryService(_store, _store, _store, _store, _store, _store), _store, _store);

    private (Domain.Foods.Food chicken, Recipe bowls, Recipe stirfry) Seed()
    {
        var chicken = _store.AddFood("Chicken breast, raw", 120, 22.5, 0, 2.6);
        Recipe Make(string name, double grams)
        {
            var r = new Recipe(name, 2);
            r.SetIngredientLines([$"{grams} g chicken breast", "1 pinch widget"]);
            var ing = r.Ingredients[0];
            (ing.FoodId, ing.FoodName, ing.Grams, ing.Status) = (chicken.Id, chicken.Name, grams, IngredientMatchStatus.Confirmed);
            _store.Recipes.Add(r);
            return r;
        }
        return (chicken, Make("Bowls", 300), Make("Stir fry", 200));
    }

    private static string KeyOf(GroceryListDto l) => l.Aisles.SelectMany(a => a.Items).Single(i => i.FoodId is not null).Key;

    [Fact]
    public async Task Hiding_an_aggregated_item_removes_the_merged_line_but_not_the_plan_or_recipes()
    {
        var (_, bowls, stirfry) = Seed();
        await Plan().AddRecipeAsync(new AddPlanRecipeRequest(_store.Today, MealSlot.Lunch, bowls.Id, 2));
        await Plan().AddRecipeAsync(new AddPlanRecipeRequest(_store.Today, MealSlot.Dinner, stirfry.Id, 2));

        var before = await Grocery().BuildAsync(_store.Today, _store.Today.AddDays(6));
        Assert.Equal(500, before.Aisles.SelectMany(a => a.Items).Single(i => i.FoodId is not null).TotalGrams);

        await Exclusions().HideAsync(new HideGroceryItemRequest(KeyOf(before), "Chicken breast"));

        var after = await Grocery().BuildAsync(_store.Today, _store.Today.AddDays(6));
        Assert.DoesNotContain(after.Aisles.SelectMany(a => a.Items), i => i.FoodId is not null);
        Assert.Equal(500, after.HiddenItems.Single().TotalGrams);
        Assert.Equal(before.ItemCount - 1, after.ItemCount);
        Assert.Equal(2, _store.Plan.Count);
        Assert.Equal(300, bowls.Ingredients[0].Grams);
    }

    [Fact]
    public async Task Exclusion_survives_quantity_changes_and_other_ranges_and_restores_cleanly()
    {
        var (_, bowls, stirfry) = Seed();
        await Plan().AddRecipeAsync(new AddPlanRecipeRequest(_store.Today, MealSlot.Lunch, bowls.Id, 2));
        var key = KeyOf(await Grocery().BuildAsync(_store.Today, _store.Today.AddDays(6)));
        await Exclusions().HideAsync(new HideGroceryItemRequest(key, "Chicken breast"));
        await Exclusions().HideAsync(new HideGroceryItemRequest(key, "Chicken breast")); // idempotent
        Assert.Single(_store.GroceryExclusions);

        // Quantity grows, and a different range is requested: still hidden.
        await Plan().AddRecipeAsync(new AddPlanRecipeRequest(_store.Today.AddDays(1), MealSlot.Dinner, stirfry.Id, 2));
        var changed = await Grocery().BuildAsync(_store.Today, _store.Today.AddDays(6));
        Assert.DoesNotContain(changed.Aisles.SelectMany(a => a.Items), i => i.FoodId is not null);
        Assert.Equal(500, changed.HiddenItems.Single().TotalGrams);
        var other = await Grocery().BuildAsync(_store.Today.AddDays(1), _store.Today.AddDays(1));
        Assert.DoesNotContain(other.Aisles.SelectMany(a => a.Items), i => i.FoodId is not null);

        await Exclusions().RestoreAsync(key);
        var restored = await Grocery().BuildAsync(_store.Today, _store.Today.AddDays(6));
        Assert.Equal(500, restored.Aisles.SelectMany(a => a.Items).Single(i => i.FoodId is not null).TotalGrams);
        Assert.Empty(restored.HiddenItems);
    }

    [Fact]
    public async Task Restore_all_and_unknown_keys_are_safe()
    {
        await Exclusions().HideAsync(new HideGroceryItemRequest("text:salt", "Salt"));
        await Exclusions().HideAsync(new HideGroceryItemRequest($"food:{Guid.NewGuid()}", null));
        await Exclusions().RestoreAsync("text:nothing");
        Assert.Equal(2, _store.GroceryExclusions.Count);
        await Exclusions().RestoreAsync(null);
        Assert.Empty(_store.GroceryExclusions);
    }

    [Theory]
    [InlineData("")]
    [InlineData("food:not-a-guid")]
    [InlineData("text:  ")]
    [InlineData("other:x")]
    public async Task Invalid_keys_are_rejected(string key) =>
        await Assert.ThrowsAsync<ArgumentException>(() => Exclusions().HideAsync(new HideGroceryItemRequest(key, "x")));

    [Fact]
    public void Key_is_by_food_when_matched_otherwise_by_lowercase_name()
    {
        var id = Guid.NewGuid();
        Assert.Equal($"food:{id}", GroceryExclusion.KeyFor(id, "anything"));
        Assert.Equal("text:fresh basil", GroceryExclusion.KeyFor(null, "  Fresh Basil "));
    }
}
