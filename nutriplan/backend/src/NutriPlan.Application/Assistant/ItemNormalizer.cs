using NutriPlan.Application.Abstractions;
using NutriPlan.Application.Foods;
using NutriPlan.Domain.Parsing;

namespace NutriPlan.Application.Assistant;

/// <summary>
/// Cleans up what an interpreter returned (the built-in rules or Claude) before foods are looked up, so a quantity or a
/// word that matters is never lost between "what was said" and "what was matched":
/// several quantified foods hiding in one phrase become separate items; an amount left inside the food text
/// ("4 oz chicken breast" with no amount field) is recovered; and a state or cooking word in the preparation note
/// ("eggs" + "scrambled") is carried into the search.
/// </summary>
public static class ItemNormalizer
{
    public static IReadOnlyList<InterpretedItem> Normalize(IEnumerable<InterpretedItem> items)
    {
        var result = new List<InterpretedItem>();
        foreach (var item in items)
        {
            var parts = QuantityTextParser.SplitByQuantity(item.FoodQuery);
            if (parts.Count > 1)
            {
                // "toast two scrambled eggs" came back as one food: separate them. Only the first keeps the item's own amount.
                for (var i = 0; i < parts.Count; i++)
                    result.Add(Normalize(parts[i], i == 0 ? item : item with { Amount = null, Unit = null, Preparation = null }));
            }
            else result.Add(Normalize(item.FoodQuery, item));
        }
        return result;
    }

    private static InterpretedItem Normalize(string text, InterpretedItem source)
    {
        var parsed = QuantityTextParser.Parse(text);
        var amount = source.Amount;
        var unit = source.Unit;
        var food = text.Trim();

        if (parsed.Amount is not null)
        {
            // The text carries an amount. If the item has none of its own, it's the amount; if it has, the text copy is just noise.
            if (amount is null) (amount, unit) = (parsed.Amount, parsed.Unit);
            food = parsed.FoodText;
        }

        var prep = source.Preparation ?? parsed.Preparation;
        var stateWord = StateWordIn(prep) ?? StateWordIn(source.CookedState);
        var alreadyStated = food.ToLowerInvariant().Split(' ', ',', '-').Any(t => FoodPreparation.IsCookedWord(t) || FoodPreparation.IsRawWord(t));
        if (stateWord is not null && !alreadyStated) food = $"{food} {stateWord}";

        return source with { FoodQuery = food, Amount = amount, Unit = string.IsNullOrWhiteSpace(unit) ? null : unit.Trim() };
    }

    private static string? StateWordIn(string? text)
    {
        if (string.IsNullOrWhiteSpace(text)) return null;
        foreach (var token in text.ToLowerInvariant().Split(' ', ',', ';', '-'))
            if (FoodPreparation.IsCookedWord(token) || FoodPreparation.IsRawWord(token)) return token;
        return null;
    }
}
