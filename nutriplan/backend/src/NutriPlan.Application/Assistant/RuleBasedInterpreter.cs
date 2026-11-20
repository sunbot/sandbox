using System.Text.RegularExpressions;
using NutriPlan.Application.Abstractions;
using NutriPlan.Domain.Diary;
using NutriPlan.Domain.Parsing;

namespace NutriPlan.Application.Assistant;

/// <summary>
/// Free, offline understanding of chat/voice text using keywords and <see cref="QuantityTextParser"/>.
/// Good for "2 eggs and toast for breakfast" or "half a pound of chicken breast"; the language model
/// handles messier phrasing when it's configured.
/// </summary>
public static partial class RuleBasedInterpreter
{
    public static InterpretedRequest Interpret(string text, DateOnly today)
    {
        var t = text.Trim();
        var lower = t.ToLowerInvariant();

        if (WhatCanIMake().IsMatch(lower))
            return new InterpretedRequest(AssistantIntent.WhatCanIMake, [], null, null, null, null, null);

        if (FillGaps().IsMatch(lower))
            return new InterpretedRequest(AssistantIntent.FillGaps, [], null, DateFrom(lower, today), null, null, null);

        if (RecipeWords().IsMatch(lower))
        {
            var count = CountWord().Match(lower) is { Success: true } m ? int.Parse(m.Groups[1].Value) : (int?)null;
            var query = RecipeFiller().Replace(lower, " ");
            query = MultiSpace().Replace(query, " ").Trim();
            return new InterpretedRequest(AssistantIntent.FindRecipes, [], null, null, query.Length == 0 ? t : query, count, null);
        }

        var meal = MealFrom(lower);
        var date = DateFrom(lower, today);
        var isLog = LogVerbs().IsMatch(lower) || meal is not null;

        var cleaned = MealPhrase().Replace(t, " ");
        cleaned = DatePhrase().Replace(cleaned, " ");
        cleaned = MultiSpace().Replace(cleaned, " ").Trim();

        var items = QuantityTextParser.SplitItems(cleaned)
            .Select(QuantityTextParser.Parse)
            .Where(p => p.FoodText.Length > 0)
            .Select(p => new InterpretedItem(p.FoodText, p.Amount, p.Unit, p.Preparation, null, CookedStateFrom(p.FoodText + " " + p.Preparation)))
            .ToList();

        return new InterpretedRequest(isLog ? AssistantIntent.LogFood : AssistantIntent.FindFood, items, meal, date, null, null, null);
    }

    public static MealSlot? MealFrom(string lower) =>
        lower.Contains("breakfast") ? MealSlot.Breakfast :
        lower.Contains("lunch") ? MealSlot.Lunch :
        lower.Contains("dinner") || lower.Contains("supper") ? MealSlot.Dinner :
        lower.Contains("snack") ? MealSlot.Snack : null;

    public static DateOnly? DateFrom(string lower, DateOnly today) =>
        lower.Contains("yesterday") ? today.AddDays(-1) :
        lower.Contains("tomorrow") ? today.AddDays(1) :
        lower.Contains("today") ? today : null;

    private static string? CookedStateFrom(string text)
    {
        var l = text.ToLowerInvariant();
        if (l.Contains("raw") || l.Contains("uncooked")) return "raw";
        if (CookedWords().IsMatch(l)) return "cooked";
        return null;
    }

    [GeneratedRegex(@"what (can|could|should) i (make|cook)|with what i have|from my pantry|in my pantry")]
    private static partial Regex WhatCanIMake();

    [GeneratedRegex(@"\b(fill|round out|close)\b.*\b(gap|gaps|day|macros|calories)\b|what should i eat|hit my (protein|macros|calories|goal)|still need|left (for|to eat)")]
    private static partial Regex FillGaps();

    [GeneratedRegex(@"\brecipes?\b|\bideas?\b|\bmeal prep\b|\bsomething to (make|cook)\b")]
    private static partial Regex RecipeWords();

    [GeneratedRegex(@"\b(\d+)\b")]
    private static partial Regex CountWord();

    [GeneratedRegex(@"\b(show|give|find|me|some|list|of|a|an|the|recipes?|ideas?|i|can|could|make|please|for|\d+)\b")]
    private static partial Regex RecipeFiller();

    [GeneratedRegex(@"^(i\s+(had|ate|drank|just)|log|add|track|ate|had)\b")]
    private static partial Regex LogVerbs();

    [GeneratedRegex(@"\b(for|at|with|during)?\s*(my\s+)?(breakfast|lunch|dinner|supper|snack)\b", RegexOptions.IgnoreCase)]
    private static partial Regex MealPhrase();

    [GeneratedRegex(@"\b(yesterday|today|tomorrow|this morning|tonight)\b", RegexOptions.IgnoreCase)]
    private static partial Regex DatePhrase();

    [GeneratedRegex(@"\b(cooked|grilled|roasted|baked|fried|boiled|steamed|broiled|scrambled|sauteed|poached)\b")]
    private static partial Regex CookedWords();

    [GeneratedRegex(@"\s{2,}")]
    private static partial Regex MultiSpace();
}
