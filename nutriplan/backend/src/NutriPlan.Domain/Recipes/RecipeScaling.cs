using System.Globalization;
using System.Text.RegularExpressions;

namespace NutriPlan.Domain.Recipes;

/// <summary>Rewrites the amount at the start of an ingredient line when a recipe is scaled.</summary>
public static partial class RecipeScaling
{
    /// <summary>
    /// Replaces the line's leading amount ("1 1/2", "3/4", "2.5", "½", "1½") with <paramref name="newAmount"/>, keeping the
    /// rest exactly ("1 can (15 oz) beans" → "2 can (15 oz) beans"). A line that doesn't start with a number is returned as is.
    /// </summary>
    public static string ScaleLeadingAmount(string line, double newAmount)
    {
        var m = LeadingAmount().Match(line);
        if (!m.Success) return line;
        return m.Groups["lead"].Value + Format(newAmount) + line[(m.Index + m.Length)..];
    }

    /// <summary>Kitchen-friendly numbers: whole numbers plain, common fractions as ½ ¼ ¾ ⅓ ⅔, else up to 2 decimals.</summary>
    public static string Format(double v)
    {
        var whole = Math.Floor(v + 1e-9);
        var frac = v - whole;
        string? f = Math.Abs(frac) < 0.01 ? "" : Math.Abs(frac - 0.5) < 0.01 ? "½" : Math.Abs(frac - 0.25) < 0.01 ? "¼" : Math.Abs(frac - 0.75) < 0.01 ? "¾"
            : Math.Abs(frac - 1 / 3.0) < 0.01 ? "⅓" : Math.Abs(frac - 2 / 3.0) < 0.01 ? "⅔" : null;
        if (f is null) return v.ToString("0.##", CultureInfo.InvariantCulture);
        return whole == 0 && f.Length > 0 ? f : whole.ToString(CultureInfo.InvariantCulture) + f;
    }

    [GeneratedRegex(@"^(?<lead>\s*[-*•]?\s*)(?:\d+\s+\d+/\d+|\d+/\d+|\d+(?:[.,]\d+)?(?:\s?[½⅓⅔¼¾⅛])?|[½⅓⅔¼¾⅛])")]
    private static partial Regex LeadingAmount();
}
