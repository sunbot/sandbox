using System.Globalization;
using System.Text.RegularExpressions;
using NutriPlan.Domain.Units;

namespace NutriPlan.Domain.Parsing;

/// <summary>A line of food text split into amount, unit and the food itself.</summary>
public sealed record ParsedFoodText(
    string Raw,
    double? Amount,
    string? Unit,
    string FoodText,
    string? Preparation,
    string? Note)
{
    public bool HasQuantity => Amount is not null;
}

/// <summary>
/// Deterministic parser for recipe ingredient lines and short food phrases:
/// "1 1/2 cups (190 g) all-purpose flour, sifted", "half a pound of chicken breast", "2 large eggs",
/// "2 (14.5 oz) cans diced tomatoes", "salt to taste".
/// This is the zero-cost path; the language model is only an optional upgrade for messy input.
/// </summary>
public static partial class QuantityTextParser
{
    private static readonly Dictionary<string, double> NumberWords = new(StringComparer.OrdinalIgnoreCase)
    {
        ["a"] = 1, ["an"] = 1, ["one"] = 1, ["two"] = 2, ["three"] = 3, ["four"] = 4, ["five"] = 5,
        ["six"] = 6, ["seven"] = 7, ["eight"] = 8, ["nine"] = 9, ["ten"] = 10, ["eleven"] = 11, ["twelve"] = 12,
        ["half"] = 0.5, ["quarter"] = 0.25, ["third"] = 1.0 / 3, ["dozen"] = 12, ["couple"] = 2, ["few"] = 3,
    };

    private static readonly Dictionary<char, double> UnicodeFractions = new()
    {
        ['½'] = 0.5, ['⅓'] = 1.0 / 3, ['⅔'] = 2.0 / 3, ['¼'] = 0.25, ['¾'] = 0.75, ['⅕'] = 0.2,
        ['⅖'] = 0.4, ['⅗'] = 0.6, ['⅘'] = 0.8, ['⅙'] = 1.0 / 6, ['⅚'] = 5.0 / 6, ['⅛'] = 0.125,
        ['⅜'] = 0.375, ['⅝'] = 0.625, ['⅞'] = 0.875,
    };

    /// <summary>Words that act as a unit for count-based foods ("2 slices bread", "3 cloves garlic").</summary>
    public static readonly IReadOnlySet<string> CountUnits = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        "large", "medium", "small", "extra-large", "jumbo", "slice", "slices", "clove", "cloves", "can", "cans",
        "piece", "pieces", "stick", "sticks", "head", "heads", "bunch", "bunches", "sprig", "sprigs", "pinch",
        "pinches", "dash", "dashes", "handful", "handfuls", "scoop", "scoops", "serving", "servings", "packet",
        "packets", "package", "packages", "bottle", "bottles", "container", "containers", "jar", "jars", "bar",
        "bars", "leaf", "leaves", "stalk", "stalks", "fillet", "fillets", "breast", "breasts", "thigh", "thighs",
        "link", "links", "strip", "strips", "patty", "patties", "envelope", "envelopes", "box", "boxes", "bag", "bags",
    };

    private static readonly string[] NoQuantityPhrases = ["to taste", "as needed", "for garnish", "for serving", "optional"];

    public static ParsedFoodText Parse(string raw)
    {
        ArgumentNullException.ThrowIfNull(raw);
        var text = Normalize(raw);

        // Pull out parenthetical notes: "(14.5 oz)", "(about 2 cups)".
        string? note = null;
        var paren = Parenthetical().Match(text);
        string? parenContent = null;
        if (paren.Success)
        {
            parenContent = paren.Groups[1].Value.Trim();
            note = parenContent;
            text = (text[..paren.Index] + " " + text[(paren.Index + paren.Length)..]).Trim();
            text = MultiSpace().Replace(text, " ");
        }

        // Preparation after the first comma: "chicken breast, diced".
        string? preparation = null;
        var comma = text.IndexOf(',');
        if (comma > 0)
        {
            preparation = text[(comma + 1)..].Trim().TrimEnd('.');
            text = text[..comma].Trim();
            if (preparation.Length == 0) preparation = null;
        }

        foreach (var phrase in NoQuantityPhrases)
        {
            if (text.Contains(phrase, StringComparison.OrdinalIgnoreCase))
            {
                text = MultiSpace().Replace(Regex.Replace(text, Regex.Escape(phrase), "", RegexOptions.IgnoreCase), " ").Trim();
                preparation = preparation is null ? phrase : $"{preparation}; {phrase}";
            }
        }

        var tokens = text.Split(' ', StringSplitOptions.RemoveEmptyEntries).ToList();
        var index = 0;
        var amount = ReadAmount(tokens, ref index);

        string? unit = null;
        if (amount is not null || index == 0)
        {
            // "fl oz" is two tokens.
            if (index + 1 < tokens.Count && tokens[index].Equals("fl", StringComparison.OrdinalIgnoreCase) &&
                tokens[index + 1].TrimEnd('.').Equals("oz", StringComparison.OrdinalIgnoreCase))
            {
                unit = "fl oz";
                index += 2;
            }
            else if (index < tokens.Count && (Units.Units.Find(tokens[index]) is not null || CountUnits.Contains(tokens[index])))
            {
                // Avoid eating a single letter food word like "T" unless it's followed by more text.
                if (index + 1 < tokens.Count || amount is not null)
                {
                    unit = tokens[index].TrimEnd('.');
                    index++;
                    amount ??= 1; // "cup of coffee", "slice of pizza"
                }
            }
        }

        // "2 (14.5 oz) cans tomatoes" → 2 × 14.5 oz.
        if (amount is not null && parenContent is not null && (unit is null || CountUnits.Contains(unit)))
        {
            var inner = Parse(parenContent);
            if (inner.Amount is not null && Units.Units.Find(inner.Unit) is { Kind: UnitKind.Mass or UnitKind.Volume })
            {
                amount *= inner.Amount;
                unit = inner.Unit;
            }
        }

        // Skip filler words: "of", "a", "the".
        while (index < tokens.Count && tokens[index] is "of" or "the" or "a" or "an")
            index++;

        var foodText = string.Join(' ', tokens.Skip(index)).Trim().Trim('-', ':').Trim();
        if (foodText.Length == 0) foodText = text;

        return new ParsedFoodText(raw, amount is null ? null : Math.Round(amount.Value, 4), unit, foodText, preparation, note);
    }

    /// <summary>Splits a sentence like "2 eggs, toast with butter and a black coffee" into item phrases.</summary>
    public static IReadOnlyList<string> SplitItems(string sentence)
    {
        var cleaned = LeadingVerb().Replace(sentence.Trim(), "");
        return ItemSeparator().Split(cleaned)
            .Select(s => s.Trim().TrimEnd('.', '!'))
            .Where(s => s.Length > 0)
            .ToList();
    }

    private static double? ReadAmount(List<string> tokens, ref int index)
    {
        double? total = null;
        while (index < tokens.Count)
        {
            var token = tokens[index];

            // Glued amount + unit: "200g", "8oz", "1.5kg".
            var glued = GluedAmountUnit().Match(token);
            if (glued.Success && Units.Units.Find(glued.Groups[2].Value) is not null)
            {
                total = (total ?? 0) + double.Parse(glued.Groups[1].Value, CultureInfo.InvariantCulture);
                tokens[index] = glued.Groups[2].Value; // leave unit for the unit reader
                return total;
            }

            var value = ParseNumberToken(token);
            if (value is null)
            {
                if (NumberWords.TryGetValue(token, out var word))
                {
                    var nextIsNumber = index + 1 < tokens.Count &&
                        (NumberWords.ContainsKey(tokens[index + 1]) || ParseNumberToken(tokens[index + 1]) is not null);
                    if (token is "a" or "an")
                    {
                        // "half a pound" (already have an amount) or "a half cup" / "a dozen" (number follows).
                        if (total is null && !nextIsNumber) total = 1;
                    }
                    else if (token == "dozen") total = (total ?? 1) * 12;
                    else total = (total ?? 0) + word;   // "one and a half" → 1 + 0.5
                    index++;
                    continue;
                }
                if (token == "and" && total is not null && index + 1 < tokens.Count &&
                    (NumberWords.ContainsKey(tokens[index + 1]) || ParseNumberToken(tokens[index + 1]) is not null))
                {
                    index++;
                    continue;
                }
                break;
            }

            // Range "2-3" or "2 to 3" → midpoint.
            if (index + 2 < tokens.Count && tokens[index + 1] is "to" or "-" or "or" && ParseNumberToken(tokens[index + 2]) is { } upper)
            {
                total = (total ?? 0) + (value.Value + upper) / 2;
                index += 3;
                continue;
            }

            total = (total ?? 0) + value.Value;
            index++;
        }

        return total;
    }

    private static double? ParseNumberToken(string token)
    {
        if (token.Length == 0) return null;
        if (token.Length == 1 && UnicodeFractions.TryGetValue(token[0], out var uf)) return uf;

        // "1½"
        if (token.Length > 1 && UnicodeFractions.TryGetValue(token[^1], out var tail) &&
            double.TryParse(token[..^1], NumberStyles.Float, CultureInfo.InvariantCulture, out var whole))
            return whole + tail;

        var range = RangeToken().Match(token);
        if (range.Success)
        {
            var a = ParseNumberToken(range.Groups[1].Value);
            var b = ParseNumberToken(range.Groups[2].Value);
            if (a is not null && b is not null) return (a.Value + b.Value) / 2;
        }

        var fraction = FractionToken().Match(token);
        if (fraction.Success)
        {
            var den = double.Parse(fraction.Groups[2].Value, CultureInfo.InvariantCulture);
            return den == 0 ? null : double.Parse(fraction.Groups[1].Value, CultureInfo.InvariantCulture) / den;
        }

        return double.TryParse(token.Replace(',', '.'), NumberStyles.Float, CultureInfo.InvariantCulture, out var number) && number >= 0
            ? number
            : null;
    }

    private static string Normalize(string raw)
    {
        var s = raw.Replace('⁄', '/').Replace(' ', ' ').Replace('–', '-').Replace('—', '-').Trim();
        s = s.TrimStart('-', '*', '•', '·').Trim();
        // "1-1/2" → "1 1/2" ; space between number and unicode fraction "1 ½" handled by tokenizer.
        s = MixedHyphen().Replace(s, "$1 $2");
        // "2 - 3" → "2-3"
        s = Regex.Replace(s, @"(\d)\s*-\s*(\d)", "$1-$2");
        return MultiSpace().Replace(s, " ");
    }

    [GeneratedRegex(@"\(([^)]*)\)")] private static partial Regex Parenthetical();
    [GeneratedRegex(@"\s{2,}")] private static partial Regex MultiSpace();
    [GeneratedRegex(@"^(\d+(?:[.,]\d+)?)([a-zA-Z]+\.?)$")] private static partial Regex GluedAmountUnit();
    [GeneratedRegex(@"^(\d+)/(\d+)$")] private static partial Regex FractionToken();
    [GeneratedRegex(@"^([\d./½¼¾⅓⅔]+)-([\d./½¼¾⅓⅔]+)$")] private static partial Regex RangeToken();
    [GeneratedRegex(@"\b(\d+)-(\d+/\d+)\b")] private static partial Regex MixedHyphen();
    [GeneratedRegex(@"^(i\s+(had|ate|drank|just\s+had|just\s+ate)|log|add|track)\s+", RegexOptions.IgnoreCase)] private static partial Regex LeadingVerb();
    [GeneratedRegex(@"\s*(?:,|;|\band\b(?!\s+(?:a\s+)?(?:half|quarter|third)\b)|\bwith\b|\bplus\b|\n)\s*", RegexOptions.IgnoreCase)] private static partial Regex ItemSeparator();
}
