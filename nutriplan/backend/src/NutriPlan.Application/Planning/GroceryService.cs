using NutriPlan.Application.Abstractions;
using NutriPlan.Domain.Foods;
using NutriPlan.Domain.Planning;
using NutriPlan.Domain.Recipes;
using NutriPlan.Domain.Units;

namespace NutriPlan.Application.Planning;

public sealed record GroceryItemDto(
    string Name,
    Guid? FoodId,
    double? TotalGrams,
    string Display,
    double? PantryGrams,
    bool InPantry,
    IReadOnlyList<string> UsedIn,
    IReadOnlyList<string> UnconvertedAmounts);

public sealed record GroceryAisleDto(string Aisle, IReadOnlyList<GroceryItemDto> Items);

public sealed record GroceryListDto(DateOnly From, DateOnly To, IReadOnlyList<GroceryAisleDto> Aisles, int ItemCount);

/// <summary>
/// Builds a shopping list from the planned (not yet eaten) meals in a date range:
/// recipe ingredients are scaled by planned servings, identical foods are merged, pantry stock is
/// subtracted, and items are grouped by food category as a stand-in for store aisles.
/// Batch-cooked recipes are only bought once.
/// </summary>
public sealed class GroceryService(IPlanRepository plan, IRecipeRepository recipes, IFoodRepository foods, IPantryRepository pantry)
{
    public async Task<GroceryListDto> BuildAsync(DateOnly from, DateOnly to, bool subtractPantry = true, CancellationToken ct = default)
    {
        var entries = (await plan.GetRangeAsync(from, to, ct)).Where(e => e.Status == PlanStatus.Planned).ToList();
        var recipeMap = await recipes.GetManyAsync(entries.Where(e => e.Item.RecipeId is not null).Select(e => e.Item.RecipeId!.Value).Distinct(), ct);

        var lines = new List<Line>();
        var seenBatches = new HashSet<Guid>();
        foreach (var entry in entries)
        {
            if (entry.Item.RecipeId is { } recipeId && recipeMap.TryGetValue(recipeId, out var recipe))
            {
                // A batch is cooked once: count the whole batch's servings on its first entry.
                double servings;
                if (entry.BatchId is { } batchId)
                {
                    if (!seenBatches.Add(batchId)) continue;
                    servings = entries.Where(e => e.BatchId == batchId).Sum(e => e.Item.Quantity);
                }
                else servings = entry.Item.Quantity;

                var factor = servings / recipe.Servings;
                foreach (var ing in recipe.Ingredients.Where(i => i.Status != IngredientMatchStatus.Ignored))
                {
                    lines.Add(new Line(ing.FoodId, ing.FoodName ?? ing.FoodText, ing.FoodText, ing.Grams * factor,
                        ing.Grams is null ? FormatRaw(ing, factor) : null, recipe.Name));
                }
            }
            else if (entry.Item.FoodId is { } foodId)
            {
                lines.Add(new Line(foodId, entry.Item.Name, entry.Item.Name, entry.Item.Grams, entry.Item.Grams is null ? $"{entry.Item.Quantity} {entry.Item.QuantityUnit}" : null, entry.Item.Name));
            }
        }

        var foodMap = await foods.GetManyAsync(lines.Where(l => l.FoodId is not null).Select(l => l.FoodId!.Value).Distinct(), ct);
        var pantryItems = subtractPantry ? await pantry.ListAsync(ct) : [];

        var items = lines
            .GroupBy(l => l.FoodId?.ToString() ?? l.Text.ToLowerInvariant())
            .Select(g =>
            {
                var first = g.First();
                var food = first.FoodId is { } id ? foodMap.GetValueOrDefault(id) : null;
                var grams = g.Any(l => l.Grams is not null) ? g.Sum(l => l.Grams ?? 0) : (double?)null;
                var pantryMatch = pantryItems.FirstOrDefault(p => (first.FoodId is not null && p.FoodId == first.FoodId) ||
                                                                  string.Equals(p.Name, first.Text, StringComparison.OrdinalIgnoreCase));
                var pantryGrams = pantryMatch?.Grams;
                var need = grams is not null && pantryGrams is not null ? Math.Max(0, grams.Value - pantryGrams.Value) : grams;
                var inPantry = pantryMatch is not null && (pantryGrams is null || need <= 0);
                return (Aisle: Aisles.For(food?.Category, first.Name),
                    Item: new GroceryItemDto(
                        ShoppingName(food, first.Name),
                        first.FoodId,
                        need is null ? null : Math.Round(need.Value, 0),
                        Display(food, need),
                        pantryGrams,
                        inPantry,
                        g.Select(l => l.UsedIn).Distinct().ToList(),
                        g.Where(l => l.RawAmount is not null).Select(l => l.RawAmount!).ToList()));
            })
            .ToList();

        var aisles = items
            .Where(i => i.Item.TotalGrams is null or >= 1) // a pinch of salt isn't a shopping item
            .GroupBy(i => i.Aisle)
            .OrderBy(g => Aisles.Order(g.Key))
            .Select(g => new GroceryAisleDto(g.Key, g.Select(x => x.Item).OrderBy(i => i.InPantry).ThenBy(i => i.Name).ToList()))
            .ToList();

        return new GroceryListDto(from, to, aisles, items.Count(i => !i.Item.InPantry));
    }

    /// <summary>"Chicken, broilers or fryers, breast, meat only, raw" → "Chicken breast" style short name.</summary>
    public static string ShoppingName(Food? food, string fallback)
    {
        if (food is null) return fallback;
        if (food.Source is FoodSource.UsdaBranded or FoodSource.OpenFoodFacts or FoodSource.User) return food.DisplayName;
        var parts = food.Name.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);
        var skip = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "nfs", "raw", "broilers or fryers", "meat only", "all commercial varieties", "fresh", "mature seeds", "regular" };
        var kept = parts.Where(p => !skip.Contains(p)).Take(2).ToList();
        return kept.Count == 0 ? food.Name : string.Join(", ", kept);
    }

    /// <summary>Grams plus a friendly portion when the food has one ("450 g (≈ 3 medium)").</summary>
    private static string Display(Food? food, double? grams)
    {
        if (grams is null) return "see recipe";
        var text = grams >= 1000 ? $"{grams / 1000:0.##} kg" : $"{grams:0} g";
        var imperial = grams >= 454 ? $"{grams / Units.Pound.ToBase:0.#} lb" : grams >= 28 ? $"{grams / Units.Ounce.ToBase:0.#} oz" : null;
        // Only count natural items ("≈ 6 banana", "≈ 2 medium"), not containers or odd measures.
        var item = food is null ? null : QuantityResolver.Resolve(food, 1, null);
        var portion = item is { Method: ResolutionMethod.DefaultPortion, Portion: { GramsPerUnit: > 15 and < 1500 } p }
                      && !p.Description.Contains("container", StringComparison.OrdinalIgnoreCase)
                      && !p.Description.Contains("package", StringComparison.OrdinalIgnoreCase)
            ? p : null;
        var count = portion is null ? null : $"≈ {Math.Ceiling(grams.Value / portion.GramsPerUnit):0} {portion.Description}";
        return string.Join(" · ", new[] { text, imperial, count }.Where(s => s is not null));
    }

    private static string FormatRaw(RecipeIngredient ing, double factor) =>
        ing.Amount is null ? ing.RawText : $"{ing.Amount * factor:0.##} {ing.Unit} {ing.FoodText}".Replace("  ", " ");

    private sealed record Line(Guid? FoodId, string Name, string Text, double? Grams, string? RawAmount, string UsedIn);
}

/// <summary>Maps USDA food categories (and, failing that, the food name) to familiar store aisles.</summary>
public static class Aisles
{
    // Checked in this order (specific before general: "Salad dressings and vegetable oils" is oils, not produce).
    private static readonly (string Aisle, string[] Keywords)[] Rules =
    [
        ("Baking & Spices", ["spice", "sugar", "sweets", "baking", "leavening", "honey", "syrup", "vanilla", "salt"]),
        ("Oils & Condiments", ["fats and oils", "oil", "dressing", "sauce", "condiment", "mayonnaise", "vinegar"]),
        ("Produce", ["fruit", "vegetable", "banana", "apple", "berr", "citrus", "melon", "lettuce", "potato", "tomato", "onion", "garlic", "avocado", "broccoli", "spinach", "carrot"]),
        ("Meat & Seafood", ["poultry", "chicken", "turkey", "beef", "pork", "lamb", "sausage", "meat", "fish", "seafood", "shellfish", "salmon", "tuna", "shrimp"]),
        ("Dairy & Eggs", ["dairy", "milk", "yogurt", "cheese", "egg", "butter", "cream"]),
        ("Bakery", ["baked product", "bread", "roll", "bagel", "tortilla", "muffin"]),
        ("Grains, Pasta & Cereal", ["cereal", "grain", "pasta", "rice", "oat", "noodle", "flour"]),
        ("Canned & Dry Goods", ["legume", "bean", "lentil", "soup", "canned", "nut", "seed"]),
        ("Beverages", ["beverage", "juice", "coffee", "tea", "soda", "water"]),
        ("Snacks", ["snack", "chip", "cracker", "cookie", "candy", "bar"]),
    ];

    /// <summary>Display order: roughly the path through a typical store.</summary>
    public static readonly string[] OrderedAisles =
    [
        "Produce", "Bakery", "Meat & Seafood", "Dairy & Eggs", "Grains, Pasta & Cereal", "Canned & Dry Goods",
        "Baking & Spices", "Oils & Condiments", "Snacks", "Beverages", "Other",
    ];

    public static string For(string? category, string name)
    {
        foreach (var text in new[] { category, name })
        {
            if (string.IsNullOrWhiteSpace(text)) continue;
            var lower = text.ToLowerInvariant();
            foreach (var (aisle, keywords) in Rules)
                if (keywords.Any(lower.Contains)) return aisle;
        }
        return "Other";
    }

    public static int Order(string aisle) => Array.IndexOf(OrderedAisles, aisle) is var i and >= 0 ? i : OrderedAisles.Length;
}
