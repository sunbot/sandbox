using System.Globalization;
using System.Text.RegularExpressions;

namespace NutriPlan.Application.Recipes.Import;

/// <summary>Extracts a number of servings from text like "4", "Serves 6-8", "12 cookies", "Makes 2 loaves".</summary>
public static partial class ServingsParser
{
    public static double? Parse(string? text)
    {
        if (string.IsNullOrWhiteSpace(text)) return null;
        var range = Range().Match(text);
        if (range.Success)
        {
            // Conservative: "serves 6-8" → 6. Bigger portions means calories are never underestimated.
            return double.Parse(range.Groups[1].Value, CultureInfo.InvariantCulture);
        }
        var number = Number().Match(text);
        return number.Success && double.TryParse(number.Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var n) && n > 0 ? n : null;
    }

    /// <summary>
    /// When the servings field is empty, look for "Serves 4", "Servings: 6 to 10", "Yield: 8" in other text
    /// (Paprika's nutrition box, notes, description, directions). First hit wins.
    /// </summary>
    public static double? FindIn(params string?[] texts)
    {
        foreach (var text in texts)
        {
            if (string.IsNullOrWhiteSpace(text)) continue;
            var m = Mention().Match(text);
            if (m.Success && Parse(m.Groups[1].Value) is { } n) return n;
        }
        return null;
    }

    [GeneratedRegex(@"\b(?:serves|servings|yield|yields|makes)\s*:?\s*(?:about\s+)?(\d+(?:\s*(?:-|–|to)\s*\d+)?)", RegexOptions.IgnoreCase)]
    private static partial Regex Mention();

    [GeneratedRegex(@"(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)")]
    private static partial Regex Range();

    [GeneratedRegex(@"\d+(?:\.\d+)?")]
    private static partial Regex Number();
}
