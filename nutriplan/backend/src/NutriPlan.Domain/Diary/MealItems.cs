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

    /// <summary>A drink measured by volume: no gram weight is recorded (it isn't known); quantity and unit say how much.</summary>
    public static ItemSnapshot ForVolumeFood(Guid foodId, string name, double ml, NutrientProfile nutrients, double? quantity = null, string? unit = null) =>
        new(ItemKind.Food, foodId, null, name, quantity ?? Math.Round(ml, 1), unit ?? "ml", null, nutrients.Rounded());

    /// <summary>
    /// <paramref name="servings"/> of a recipe. It can be shown in another measure the recipe really has (<paramref name="quantity"/>
    /// <paramref name="unit"/>, e.g. "250 g" when its finished weight is known); nutrition is always servings × per-serving.
    /// </summary>
    public static ItemSnapshot ForRecipe(Guid recipeId, string name, double servings, NutrientProfile nutrientsPerServing,
        double? quantity = null, string? unit = null, double? grams = null) =>
        new(ItemKind.Recipe, null, recipeId, name, Math.Round(quantity ?? servings, 3), unit ?? (servings == 1 ? "serving" : "servings"),
            grams is { } g ? Math.Round(g, 2) : null, nutrientsPerServing.Scale(servings).Rounded());

    public static ItemSnapshot QuickCalories(string name, double calories, double? protein = null, double? carbs = null, double? fat = null)
    {
        var amounts = new Dictionary<int, double> { [NutrientIds.Energy] = calories };
        if (protein is not null) amounts[NutrientIds.Protein] = protein.Value;
        if (carbs is not null) amounts[NutrientIds.Carbohydrate] = carbs.Value;
        if (fat is not null) amounts[NutrientIds.Fat] = fat.Value;
        return new(ItemKind.QuickCalories, null, null, name, 1, "entry", null, new NutrientProfile(amounts));
    }

    /// <summary>
    /// Same item, a new amount in a (possibly different) unit. The logged nutrition is scaled by the ratio of the new to the
    /// old base amount (grams, ml or servings): the numbers logged at the time stay the basis, and the displayed amount,
    /// its unit and its weight always agree.
    /// </summary>
    public ItemSnapshot WithAmount(double factor, double quantity, string unit, double? newGrams) => this with
    {
        Quantity = Math.Round(quantity, 3),
        QuantityUnit = unit,
        Grams = Grams is null && newGrams is null ? null : newGrams is { } g ? Math.Round(g, 2) : Math.Round(Grams!.Value * factor, 2),
        Nutrients = Nutrients.Scale(factor).Rounded(),
    };

    /// <summary>Same item, different amount: nutrients scale linearly.</summary>
    public ItemSnapshot WithScale(double factor) => this with
    {
        Quantity = Math.Round(Quantity * factor, 3),
        Grams = Grams is null ? null : Math.Round(Grams.Value * factor, 2),
        Nutrients = Nutrients.Scale(factor).Rounded(),
    };
}

public sealed class DiaryEntry : Users.IOwned
{
    /// <summary>The user this record belongs to (set by the repository from the signed-in user).</summary>
    public Guid OwnerId { get; private set; }
    public void AssignOwner(Guid ownerId) => OwnerId = Users.Ownership.Assign(OwnerId, ownerId);

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
