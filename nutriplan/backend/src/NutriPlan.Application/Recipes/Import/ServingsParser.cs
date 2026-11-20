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

    [GeneratedRegex(@"(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)")]
    private static partial Regex Range();

    [GeneratedRegex(@"\d+(?:\.\d+)?")]
    private static partial Regex Number();
}
