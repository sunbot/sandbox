using System.Globalization;
using System.Text.RegularExpressions;

namespace NutriPlan.Domain.Recipes;

/// <summary>Scales the amount written at the start of an ingredient line when a recipe is scaled.</summary>
public static partial class RecipeScaling
{
    private static readonly Dictionary<char, double> Vulgar = new() { ['½'] = 0.5, ['⅓'] = 1 / 3.0, ['⅔'] = 2 / 3.0, ['¼'] = 0.25, ['¾'] = 0.75, ['⅛'] = 0.125 };

    /// <summary>
    /// Multiplies the number (or range) the line starts with by <paramref name="factor"/>, keeping everything else exactly:
    /// "1 1/2 cups flour" ×2 → "3 cups flour", "2-3 cloves garlic" ×2 → "4-6 cloves garlic", "1 can (15 oz) beans" ×2 →
    /// "2 can (15 oz) beans" (a package size in parentheses is not an amount). Returns whether the text changed; a line that
    /// doesn't start with a number ("Salt to taste", "Olive oil (about 2 tbsp)") is returned as is.
    /// </summary>
    public static (string Text, bool Rewritten) ScaleLeadingAmount(string line, double factor)
    {
        var m = LeadingAmount().Match(line);
        if (!m.Success) return (line, false);
        var first = Parse(m.Groups["a"].Value);
        if (first is null) return (line, false);
        var scaled = Format(first.Value * factor);
        if (m.Groups["b"].Success && Parse(m.Groups["b"].Value) is { } second)
            scaled += m.Groups["sep"].Value + Format(second * factor);
        return (m.Groups["lead"].Value + scaled + line[(m.Index + m.Length)..], true);
    }

    /// <summary>"1 1/2", "3/4", "2.5", "2,5", "½", "1½", "1 ½" as a number; null if it isn't one.</summary>
    public static double? Parse(string text)
    {
        var t = text.Trim().Replace(',', '.');
        double whole = 0;
        if (t.Length > 0 && Vulgar.TryGetValue(t[^1], out var vf))
        {
            var rest = t[..^1].Trim();
            if (rest.Length == 0) return vf;
            return double.TryParse(rest, NumberStyles.Float, CultureInfo.InvariantCulture, out whole) ? whole + vf : null;
        }
        var parts = t.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length == 2 && double.TryParse(parts[0], NumberStyles.Float, CultureInfo.InvariantCulture, out whole) && Fraction(parts[1]) is { } f2) return whole + f2;
        if (parts.Length == 1) return Fraction(parts[0]) ?? (double.TryParse(parts[0], NumberStyles.Float, CultureInfo.InvariantCulture, out var d) ? d : null);
        return null;
    }

    private static double? Fraction(string s)
    {
        var bits = s.Split('/');
        return bits.Length == 2 && double.TryParse(bits[0], NumberStyles.Float, CultureInfo.InvariantCulture, out var n)
               && double.TryParse(bits[1], NumberStyles.Float, CultureInfo.InvariantCulture, out var d) && d != 0 ? n / d : null;
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

    // A number: "1 1/2", "1/2", "2.5", "1½", "1 ½", "½"; optionally a range "2-3", "2 – 3", "2 to 3". A list marker ("1. ")
    // isn't an amount: a number followed by "." and a space doesn't match.
    private const string Num = @"(?:\d+\s+\d+/\d+|\d+/\d+|\d+(?:[.,]\d+)?(?:\s?[½⅓⅔¼¾⅛])?|[½⅓⅔¼¾⅛])";

    [GeneratedRegex(@"^(?<lead>\s*[-*•]?\s*)(?<a>" + Num + @")(?:(?<sep>\s*(?:-|–|to)\s*)(?<b>" + Num + @"))?(?!\.\s|\d|/)")]
    private static partial Regex LeadingAmount();
}
