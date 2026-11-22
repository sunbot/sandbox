using NutriPlan.Application.Abstractions;
using NutriPlan.Application.Common;
using NutriPlan.Domain.Diary;
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

    public static async Task<ItemSnapshot> ChangeAsync(ItemSnapshot item, double amount, string? unit, IFoodRepository foods, CancellationToken ct)
    {
        if (!double.IsFinite(amount) || amount <= 0) throw new ValidationException("Enter an amount greater than zero.");
        switch (item.Kind)
        {
            case ItemKind.QuickCalories:
                throw new ValidationException("A quick calorie entry has no amount to change. Edit its calories instead.");

            case ItemKind.Recipe:
            {
                if (!string.IsNullOrWhiteSpace(unit) && !unit.Trim().StartsWith("serving", StringComparison.OrdinalIgnoreCase))
                    throw new ValidationException("Recipes are measured in servings.");
                if (amount > MaxServings) throw new ValidationException($"That's more than {MaxServings} servings. Check the amount.");
                if (item.Quantity <= 0) throw new ValidationException("This entry has no amount to scale from.");
                return item.WithAmount(amount / item.Quantity, amount, amount == 1 ? "serving" : "servings", null);
            }
        }

        var food = item.FoodId is { } id ? await foods.GetAsync(id, ct) : null;
        var sameUnit = string.IsNullOrWhiteSpace(unit) || SameUnit(unit, item.QuantityUnit);
        if (food is null)
        {
            // The food is gone (or not yours): only the amount in the entry's own unit can change.
            if (!sameUnit || item.Quantity <= 0) throw new ValidationException("This food is no longer available, so only its amount in the same unit can change.");
            return Bounded(item.WithAmount(amount / item.Quantity, amount, item.QuantityUnit, null));
        }

        var unitText = string.IsNullOrWhiteSpace(unit) ? item.QuantityUnit : unit.Trim();
        var resolved = QuantityResolver.Resolve(food, amount, unitText);
        if (resolved.Grams is not { } newBase || newBase <= 0) throw new ValidationException(resolved.Explanation);

        // How much the entry held before, in the same base (grams, or ml for a drink): its recorded weight, else its own
        // amount converted the same way. Same unit → the exact ratio of amounts, needing no conversion at all.
        double factor;
        if (sameUnit && item.Quantity > 0) factor = amount / item.Quantity;
        else
        {
            var oldBase = !food.IsVolume && item.Grams is > 0 ? item.Grams.Value : QuantityResolver.Resolve(food, item.Quantity, item.QuantityUnit).Grams;
            if (oldBase is not > 0) throw new ValidationException("This entry's original amount can't be converted, so change it in its own unit.");
            factor = newBase / oldBase.Value;
        }
        var canonical = CanonicalUnit(food, unitText);
        return Bounded(item.WithAmount(factor, amount, canonical, food.IsVolume ? null : newBase));
    }

    private static ItemSnapshot Bounded(ItemSnapshot item) =>
        item.Grams > MaxGrams ? throw new ValidationException($"That's more than {MaxGrams / 1000:0} kg. Check the amount.") : item;

    private static bool SameUnit(string a, string b)
    {
        if (string.Equals(a.Trim(), b.Trim(), StringComparison.OrdinalIgnoreCase)) return true;
        var ua = Units.Find(a);
        return ua is not null && ua == Units.Find(b);
    }

    /// <summary>The unit as the food's measures name it ("almond", "cup", "g"), so the entry reads naturally.</summary>
    private static string CanonicalUnit(Domain.Foods.Food food, string unitText) =>
        FoodMeasures.Match(FoodMeasures.For(food), unitText)?.Unit ?? unitText;
}
