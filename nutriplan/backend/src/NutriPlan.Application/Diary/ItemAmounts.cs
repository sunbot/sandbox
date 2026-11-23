using NutriPlan.Application.Abstractions;
using NutriPlan.Application.Common;
using NutriPlan.Domain.Diary;
using NutriPlan.Domain.Recipes;
using NutriPlan.Domain.Units;

namespace NutriPlan.Application.Diary;

/// <summary>
/// Changing how much of a logged or planned item there is, in any measure the food really supports (12 almonds → 1 oz,
/// 150 g → 1 container). The new amount is converted by the same <see cref="QuantityResolver"/> used when logging, and the
/// item's own logged nutrition is scaled by the change in weight, so historical numbers are never re-read from a food
/// that has since changed, and the amount shown, its unit and its weight always agree.
/// </summary>
public static class ItemAmounts
{
    /// <summary>Upper bounds that catch a typo (a misplaced zero) rather than restrict real eating.</summary>
    public const double MaxGrams = 5000;
    public const double MaxServings = 50;

    /// <summary>Below these an amount rounds away to nothing (and couldn't be undone), so it's refused.</summary>
    public const double MinQuantity = 0.001;
    public const double MinBase = 0.01;

    /// <param name="grams">
    /// Optional weight for the amount, used only when the unit itself can't be converted (an older entry's own unit such
    /// as "oz (23 whole kernels)", restored by Undo). Never used for a drink measured by volume.
    /// </param>
    public static async Task<ItemSnapshot> ChangeAsync(ItemSnapshot item, double amount, string? unit, IFoodRepository foods, CancellationToken ct, double? grams = null,
        IRecipeRepository? recipes = null)
    {
        if (!double.IsFinite(amount) || amount <= 0) throw new ValidationException("Enter an amount greater than zero.");
        if (amount < MinQuantity) throw new ValidationException("That amount is too small to log.");
        switch (item.Kind)
        {
            case ItemKind.QuickCalories:
                throw new ValidationException("A quick calorie entry has no amount to change. Edit its calories instead.");

            case ItemKind.Recipe:
            {
                if (item.Quantity <= 0) throw new ValidationException("This entry has no amount to scale from.");
                var itemIsServings = RecipeMeasures.IsServing(item.QuantityUnit);
                var sameUnit = string.IsNullOrWhiteSpace(unit) || (RecipeMeasures.IsServing(unit) ? itemIsServings
                    : !itemIsServings && Units.Find(unit) is { } u1 && u1 == Units.Find(item.QuantityUnit));
                if (sameUnit)
                {
                    // Same measure: scale by the ratio of amounts, from the entry's own snapshot.
                    var f = amount / item.Quantity;
                    // The typo guard is on servings for every recipe entry (a soup in cups too), when they're known.
                    if (item.RecipeServings is { } sv0) CheckServings(sv0 * f);
                    else if (itemIsServings) CheckServings(amount);
                    var newUnit = itemIsServings ? (amount == 1 ? "serving" : "servings") : item.QuantityUnit;
                    return item.WithAmount(f, amount, newUnit, item.Grams is { } g0 ? g0 * f : null);
                }
                // Another measure (servings ↔ grams/cups): the new amount is read as servings through the recipe's finished
                // weight/volume; the old one is the snapshot's own servings (so a later change to the recipe doesn't skew it).
                var recipe = item.RecipeId is { } rid && recipes is not null ? await recipes.GetAsync(rid, ct) : null;
                if (recipe is null) throw new ValidationException("This recipe is no longer available, so only its amount in the same measure can change.");
                var to = RecipeMeasures.Resolve(recipe, amount, unit);
                if (!to.IsResolved) throw new ValidationException(to.Explanation);
                var fromServings = item.RecipeServings ?? RecipeMeasures.Resolve(recipe, item.Quantity, item.QuantityUnit).Servings;
                if (fromServings is not > 0) throw new ValidationException("This entry's original amount can't be converted, so change it in its own measure.");
                CheckServings(to.Servings!.Value);
                var (q, label) = RecipeLabel(to.Servings!.Value, amount, unit);
                // Recipes are bounded by servings (50), not the 5 kg food limit: a big batch can weigh more.
                return item.WithAmount(to.Servings!.Value / fromServings.Value, q, label, to.Grams) with { Servings = Math.Round(to.Servings!.Value, 4) };
            }
        }

        var food = item.FoodId is { } id ? await foods.GetAsync(id, ct) : null;
        var measures = food is null ? [] : FoodMeasures.For(food);

        // Same unit as the entry already has ("2 eggs" → 3, "10 almonds" → 20): scale by the ratio of amounts, keep the
        // entry's own unit, and never need a conversion (so any entry, however old its unit, can always change its amount).
        if (item.Quantity > 0 && (string.IsNullOrWhiteSpace(unit) || SameUnit(unit, item.QuantityUnit, measures)))
        {
            var f = amount / item.Quantity;
            var ml = food is { IsVolume: true } ? QuantityResolver.Resolve(food, amount, item.QuantityUnit).Grams : null; // a drink's size, when its unit converts
            return Bounded(item.WithAmount(f, amount, item.QuantityUnit, item.Grams is { } g0 ? g0 * f : null), food?.IsVolume ?? false, ml);
        }
        if (food is null)
            throw new ValidationException("This food is no longer available, so only its amount in the same unit can change.");

        var unitText = unit!.Trim();
        var resolved = QuantityResolver.Resolve(food, amount, unitText);
        double newBase;
        if (resolved.Grams is { } r && r > 0) newBase = r;
        else if (grams is > 0 && !food.IsVolume && item.Grams is > 0) newBase = grams.Value; // Undo back to an older entry's own unit
        else throw new ValidationException(resolved.Explanation);
        if (newBase < MinBase) throw new ValidationException("That amount is too small to log.");

        // Different unit: scale by the ratio of weights (grams, or ml for a drink). The entry's previous weight is its
        // recorded one, else its own amount converted the same way.
        var oldBase = !food.IsVolume && item.Grams is > 0 ? item.Grams.Value : QuantityResolver.Resolve(food, item.Quantity, item.QuantityUnit).Grams;
        if (oldBase is not > 0) throw new ValidationException("This entry's original amount can't be converted, so change it in its own unit.");
        var factor = newBase / oldBase.Value;
        var canonical = resolved.Grams is > 0 ? FoodMeasures.Match(measures, unitText)?.Unit ?? unitText : unitText;
        return Bounded(item.WithAmount(factor, amount, canonical, food.IsVolume ? null : newBase), food.IsVolume, food.IsVolume ? newBase : null);
    }

    /// <summary>A new recipe item: <paramref name="amount"/> servings, or <paramref name="amount"/> in one of the recipe's measures.</summary>
    public static ItemSnapshot RecipeItem(Recipe recipe, double amount, string? unit)
    {
        var a = RecipeMeasures.Resolve(recipe, amount, unit);
        if (!a.IsResolved) throw new ValidationException(a.Explanation);
        CheckServings(a.Servings!.Value); // recipes are bounded by servings, not by the 5 kg food limit
        var (q, label) = RecipeLabel(a.Servings!.Value, amount, unit);
        return ItemSnapshot.ForRecipe(recipe.Id, recipe.Name, a.Servings!.Value, recipe.NutritionPerServing, q, label, a.Grams);
    }

    private static void CheckServings(double servings)
    {
        if (servings > MaxServings) throw new ValidationException($"That's more than {MaxServings} servings. Check the amount.");
        if (servings < MinBase) throw new ValidationException("That amount is too small to log.");
    }

    /// <summary>How a recipe amount is shown: in servings, or in the measure it was given in ("250 g", "1.5 cup").</summary>
    private static (double Quantity, string Unit) RecipeLabel(double servings, double amount, string? unit) =>
        string.IsNullOrWhiteSpace(unit) || RecipeMeasures.IsServing(unit)
            ? (servings, servings == 1 ? "serving" : "servings")
            : (amount, Units.Find(unit)?.Name ?? unit.Trim());

    /// <summary>Refuses an amount over the typo limit: 5 kg, or 5 litres for a drink measured by volume.</summary>
    public static void CheckBase(double baseAmount, bool isVolume)
    {
        if (baseAmount > MaxGrams) throw new ValidationException(isVolume ? $"That's more than {MaxGrams / 1000:0} litres. Check the amount." : $"That's more than {MaxGrams / 1000:0} kg. Check the amount.");
    }

    private static ItemSnapshot Bounded(ItemSnapshot item, bool isVolume, double? ml)
    {
        if (item.Grams is { } g) CheckBase(g, false);
        if (ml is { } v) CheckBase(v, true);
        if (item.Grams is < MinBase) throw new ValidationException("That amount is too small to log.");
        return item;
    }

    /// <summary>Same unit, however it's written: "almond"/"almonds", "oz"/"ounces", "serving"/"servings".</summary>
    private static bool SameUnit(string a, string b, IReadOnlyList<FoodMeasure> measures)
    {
        string Norm(string s) { var t = s.Trim().ToLowerInvariant(); return t.EndsWith('s') && !t.EndsWith("ss") && t.Length > 3 ? t[..^1] : t; }
        if (Norm(a) == Norm(b)) return true;
        var ua = Units.Find(a);
        if (ua is not null && ua == Units.Find(b)) return true;
        var ma = FoodMeasures.Match(measures, a);
        return ma is not null && ma == FoodMeasures.Match(measures, b);
    }
}
