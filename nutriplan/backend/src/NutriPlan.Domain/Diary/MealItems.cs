using NutriPlan.Domain.Nutrients;

namespace NutriPlan.Domain.Diary;

public enum MealSlot { Breakfast = 0, Lunch = 1, Dinner = 2, Snack = 3 }

public enum ItemKind { Food, Recipe, QuickCalories }

/// <summary>
/// "What and how much": the shared shape of a diary entry and a planned meal.
/// Nutrients are snapshotted at the time the item is created so history never silently changes
/// when a food is later edited. Use <c>Refresh</c> flows explicitly if you want new numbers.
/// </summary>
public sealed record ItemSnapshot(
    ItemKind Kind,
    Guid? FoodId,
    Guid? RecipeId,
    string Name,
    double Quantity,
    string QuantityUnit,
    double? Grams,
    NutrientProfile Nutrients)
{
    public static ItemSnapshot ForFood(Guid foodId, string name, double grams, NutrientProfile nutrients, double? quantity = null, string? unit = null) =>
        new(ItemKind.Food, foodId, null, name, quantity ?? grams, unit ?? "g", grams, nutrients.Rounded());

    public static ItemSnapshot ForRecipe(Guid recipeId, string name, double servings, NutrientProfile nutrientsPerServing) =>
        new(ItemKind.Recipe, null, recipeId, name, servings, servings == 1 ? "serving" : "servings", null,
            nutrientsPerServing.Scale(servings).Rounded());

    public static ItemSnapshot QuickCalories(string name, double calories, double? protein = null, double? carbs = null, double? fat = null)
    {
        var amounts = new Dictionary<int, double> { [NutrientIds.Energy] = calories };
        if (protein is not null) amounts[NutrientIds.Protein] = protein.Value;
        if (carbs is not null) amounts[NutrientIds.Carbohydrate] = carbs.Value;
        if (fat is not null) amounts[NutrientIds.Fat] = fat.Value;
        return new(ItemKind.QuickCalories, null, null, name, 1, "entry", null, new NutrientProfile(amounts));
    }

    /// <summary>Same item, different amount: nutrients scale linearly.</summary>
    public ItemSnapshot WithScale(double factor) => this with
    {
        Quantity = Math.Round(Quantity * factor, 3),
        Grams = Grams is null ? null : Math.Round(Grams.Value * factor, 2),
        Nutrients = Nutrients.Scale(factor).Rounded(),
    };
}

public sealed class DiaryEntry
{
    private DiaryEntry() { } // EF

    public DiaryEntry(DateOnly date, MealSlot meal, ItemSnapshot item, Guid? planEntryId = null)
    {
        Id = Guid.NewGuid();
        Date = date;
        Meal = meal;
        Item = item;
        PlanEntryId = planEntryId;
        LoggedAt = DateTimeOffset.UtcNow;
    }

    public Guid Id { get; private set; }
    public DateOnly Date { get; private set; }
    public MealSlot Meal { get; private set; }
    public ItemSnapshot Item { get; private set; } = null!;
    /// <summary>Set when this entry fulfils a planned meal, enabling planned-vs-actual views.</summary>
    public Guid? PlanEntryId { get; private set; }
    public string? Note { get; set; }
    public DateTimeOffset LoggedAt { get; private set; }

    public void Move(DateOnly date, MealSlot meal) { Date = date; Meal = meal; }

    public void Rescale(double factor) => Item = Item.WithScale(factor);

    public void Replace(ItemSnapshot item) => Item = item;
}
