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
        ["thirteen"] = 13, ["fourteen"] = 14, ["fifteen"] = 15, ["sixteen"] = 16, ["seventeen"] = 17, ["eighteen"] = 18,
        ["nineteen"] = 19, ["twenty"] = 20, ["thirty"] = 30, ["forty"] = 40, ["fifty"] = 50, ["sixty"] = 60,
        ["seventy"] = 70, ["eighty"] = 80, ["ninety"] = 90, ["hundred"] = 100,
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

    private static readonly HashSet<string> MeasureAdjectives = new(StringComparer.OrdinalIgnoreCase)
    {
        "packed", "heaping", "heaped", "level", "generous", "scant", "loosely", "firmly", "lightly", "rounded", "big", "full",
    };

    /// <summary>Describing words that recipes separate with commas ("boneless, skinless chicken").</summary>
    private static readonly HashSet<string> Descriptors = new(StringComparer.OrdinalIgnoreCase)
    {
        "boneless", "skinless", "bone-in", "skin-on", "fresh", "frozen", "ripe", "unsalted", "salted", "low-sodium",
        "reduced-sodium", "sweet", "hot", "mild", "large", "small", "medium", "lean", "extra-lean", "organic", "plain",
    };

    private static readonly string[] NoQuantityPhrases = ["to taste", "as needed", "for garnish", "for serving", "optional"];

    [GeneratedRegex(@"^(?:bowl|plate|serving|portion|helping|handful|glass|mug)s?\s+of\s+", RegexOptions.IgnoreCase)]
    private static partial Regex Container();

    public static ParsedFoodText Parse(string raw)
    {
        ArgumentNullException.ThrowIfNull(raw);
        var text = Normalize(raw);

        // Pull out parenthetical notes: "(14.5 oz)", "(about 2 cups)".
        string? note = null;
        var paren = Parenthetical().Match(text);
        string? parenContent = null;
        var parenIsPerItem = false; // "2 (15-ounce) cans": size of each item, right after the count
        if (paren.Success)
        {
            parenContent = paren.Groups[1].Value.Trim();
            parenIsPerItem = LeadingAmountOnly().IsMatch(text[..paren.Index]);
            note = parenContent;
            text = (text[..paren.Index] + " " + text[(paren.Index + paren.Length)..]).Trim();
            text = MultiSpace().Replace(text, " ");
        }

        // Preparation after the first comma: "chicken breast, diced".
        string? preparation = null;
        var comma = text.IndexOf(',');
        // "4 boneless, skinless chicken breasts": a comma between describing words isn't the start of the preparation.
        while (comma > 0 && Descriptors.Contains(text[..comma].Trim().Split(' ')[^1]))
        {
            var next = text.IndexOf(',', comma + 1);
            text = text[..comma] + text[(comma + 1)..];
            comma = next < 0 ? -1 : next - 1;
        }
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
        // "5 packed cups", "2 heaping tbsp": the measuring word comes after the adjective.
        if (amount is not null && index + 1 < tokens.Count && MeasureAdjectives.Contains(tokens[index])
            && (Units.Units.Find(tokens[index + 1]) is not null || CountUnits.Contains(tokens[index + 1])))
            tokens.RemoveAt(index);

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

        var innerQty = parenContent is null ? null : Parse(Approximately().Replace(ParenSeparator().Replace(parenContent, " "), ""));
        var innerUnit = innerQty?.Amount is null ? null : Units.Units.Find(innerQty.Unit);

        if (amount is not null && innerUnit is not null && parenIsPerItem && (unit is null || CountUnits.Contains(unit)))
        {
            // "2 (14.5 oz) cans tomatoes" → 2 × 14.5 oz.
            if (innerUnit.Kind is UnitKind.Mass or UnitKind.Volume)
            {
                amount *= innerQty!.Amount;
                unit = innerQty.Unit;
            }
        }
        else if (amount is not null && innerUnit is { Kind: UnitKind.Mass } && !parenIsPerItem
                 && (unit is null || CountUnits.Contains(unit) || Units.Units.Find(unit) is { Kind: UnitKind.Volume or UnitKind.Mass }))
        {
            // A weight in the note is the most precise amount there is: "1 cup (220 g) brown sugar" → 220 g,
            // "4 chicken breasts (about 1½ pounds)" → 1.5 lb in total.
            amount = innerQty!.Amount;
            unit = innerQty.Unit;
        }

        // "Olive oil (about 2 tbsp for searing)": no amount up front, but the note has one.
        if (amount is null && innerUnit is not null)
        {
            amount = innerQty!.Amount;
            unit = innerQty.Unit;
        }

        // "chicken breast 4 oz": an amount said after the food. Only real units count, so "chicken 65" stays a food.
        // "a bowl of quinoa 200 g": a stated weight or volume beats a vague container word like bowl/piece.
        if ((amount is null || (amount == 1 && (unit is null || CountUnits.Contains(unit)))) && tokens.Count - index >= 2)
        {
            var last = tokens[^1];
            var glued = GluedAmountUnit().Match(last);
            if (glued.Success && Units.Units.Find(glued.Groups[2].Value) is { Kind: UnitKind.Mass or UnitKind.Volume })
            {
                amount = double.Parse(glued.Groups[1].Value, CultureInfo.InvariantCulture);
                unit = glued.Groups[2].Value;
                tokens.RemoveAt(tokens.Count - 1);
            }
            else if (tokens.Count - index >= 3 && Units.Units.Find(last) is { Kind: UnitKind.Mass or UnitKind.Volume } && ParseNumberToken(tokens[^2]) is { } tail)
            {
                amount = tail;
                unit = last.TrimEnd('.');
                tokens.RemoveRange(tokens.Count - 2, 2);
            }
        }

        // "1 whole chicken, 4–5 lb": a weight right after the comma is the amount.
        if ((amount is null || unit is null || CountUnits.Contains(unit)) && preparation is not null && preparation.Any(char.IsDigit))
        {
            var first = preparation.Split(',')[0];
            var prepQty = Parse(Approximately().Replace(first, ""));
            if (prepQty.Amount is not null && Units.Units.Find(prepQty.Unit) is { Kind: UnitKind.Mass })
            {
                // "2 chicken breasts, 8 oz each" → 16 oz.
                var each = first.Contains("each", StringComparison.OrdinalIgnoreCase) && amount is > 1 ? amount.Value : 1;
                amount = prepQty.Amount * each;
                unit = prepQty.Unit;
            }
        }

        // Skip filler words: "of", "a", "the".
        while (index < tokens.Count && tokens[index] is "of" or "the" or "a" or "an")
            index++;

        var foodText = string.Join(' ', tokens.Skip(index)).Trim().Trim('-', ':').Trim();
        if (foodText.Length == 0) foodText = text;
        // "a bowl of quinoa 200 g": once an exact weight or volume is known, the container word says nothing about the food.
        if (unit is not null && Units.Units.Find(unit) is { Kind: UnitKind.Mass or UnitKind.Volume })
        {
            var stripped = Container().Replace(foodText, "");
            if (stripped.Length > 0) foodText = stripped;
        }

        return new ParsedFoodText(raw, amount is null ? null : Math.Round(amount.Value, 4), unit, foodText, preparation, note);
    }

    /// <summary>Splits a sentence like "2 eggs, toast with butter and a black coffee" into item phrases.</summary>
    public static IReadOnlyList<string> SplitItems(string sentence)
    {
        var cleaned = LeadingVerb().Replace(sentence.Trim(), "");
        cleaned = HundredAnd().Replace(cleaned, "$1 "); // "two hundred and fifty grams" is one amount, not two items
        return ItemSeparator().Split(cleaned)
            .Select(s => s.Trim().TrimEnd('.', '!'))
            .Where(s => s.Length > 0)
            .SelectMany(SplitByQuantity)
            .ToList();
    }

    /// <summary>
    /// Spoken lists often have no commas or "and": "two pieces of toast two scrambled eggs". A new quantity starts a new
    /// food once the current one already has a food word; numbers that belong to the same amount ("1 1/2 cups", "half a
    /// pound", "twenty five grams") and numbers inside a name ("2% milk", "80/20 beef") don't split. A stray trailing
    /// amount ("chicken breast 4 oz") is kept with its food.
    /// </summary>
    public static IReadOnlyList<string> SplitByQuantity(string phrase)
    {
        var tokens = phrase.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        var segments = new List<List<string>>();
        var current = new List<string>();
        var hasFood = false;
        for (var i = 0; i < tokens.Length; i++)
        {
            var bare = tokens[i].Trim(',', ';', '.', '!', '?').ToLowerInvariant();
            var next = i + 1 < tokens.Length ? tokens[i + 1].Trim(',', ';', '.', '!', '?').ToLowerInvariant() : null;
            if (StartsQuantity(bare, next))
            {
                if (hasFood) { segments.Add(current); current = []; hasFood = false; }
                current.Add(tokens[i]);
                continue;
            }
            current.Add(tokens[i]);
            if (IsFoodWord(bare)) hasFood = true;
        }
        if (current.Count > 0) segments.Add(current);

        // A segment with no food word of its own ("4 oz" after "chicken breast") belongs to the one before it.
        var merged = new List<List<string>>();
        foreach (var seg in segments)
        {
            var food = seg.Any(t => IsFoodWord(t.Trim(',', ';', '.', '!', '?').ToLowerInvariant()));
            if (!food && merged.Count > 0) merged[^1].AddRange(seg);
            else merged.Add(seg);
        }
        return merged.Select(seg => string.Join(' ', seg)).ToList();
    }

    private static readonly HashSet<string> NotAmountsAfterArticle = new(StringComparer.OrdinalIgnoreCase)
        { "day", "week", "month", "year", "time", "while", "bit", "lot", "little", "few", "couple", "side", "half", "third", "quarter", "dozen" };

    private static readonly HashSet<string> Fillers = new(StringComparer.OrdinalIgnoreCase)
        { "of", "the", "a", "an", "and", "to", "or", "-", "about", "around", "approximately", "roughly", "some", "like", "maybe", "just" };

    private static bool StartsQuantity(string bare, string? next)
    {
        if (bare.Length == 0 || bare.EndsWith('%') || next == "%") return false;
        if (bare is "a" or "an") return next is not null && !NotAmountsAfterArticle.Contains(next);
        if (NumberWords.ContainsKey(bare)) return true;
        if (PercentRatio().IsMatch(bare)) return false; // "80/20" ground beef is a name, not 4
        return ParseNumberToken(bare) is not null || GluedAmountUnit().IsMatch(bare);
    }

    private static bool IsFoodWord(string bare) =>
        bare.Length > 0 && !Fillers.Contains(bare) && !NumberWords.ContainsKey(bare) && ParseNumberToken(bare) is null
        && !GluedAmountUnit().IsMatch(bare) && Units.Units.Find(bare) is null && !CountUnits.Contains(bare);

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
                    else if (token == "hundred") total = (total ?? 1) * 100;   // "one hundred twenty five" → 125
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

            // "1 16 ounce jar" → one 16-ounce jar (a count, then the size), not 17.
            if (total is { } count && count == Math.Floor(count) && WholeNumber().IsMatch(token) && value.Value >= 2)
            {
                total = count * value.Value;
                index++;
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
        // List markers from copied recipes: "- ", "• ", "▢ ", "☐ ", "✓ ", and numbered steps "1. 1/4 cup" / "2) 3 eggs".
        s = ListMarker().Replace(s, "");
        s = NumberedMarker().Replace(s, "");
        // "1 ½ cups/340 grams butter" → "1 ½ cups (340 grams) butter".
        s = SlashWeight().Replace(s, "$1 ($2)");
        // "15-ounce can", "1-inch piece" → "15 ounce", "1 inch".
        s = HyphenSize().Replace(s, "$1 $2");
        // Markdown emphasis: "2 tsp garlic powder *(or 4 cloves)*", "**1 cup** milk".
        s = s.Replace("*", "").Replace("__", "");
        // "1-1/2" → "1 1/2" ; space between number and unicode fraction "1 ½" handled by tokenizer.
        s = MixedHyphen().Replace(s, "$1 $2");
        // "2 - 3" → "2-3"
        s = Regex.Replace(s, @"(\d)\s*-\s*(\d)", "$1-$2");
        return MultiSpace().Replace(s, " ");
    }

    [GeneratedRegex(@"\(([^)]*)\)")] private static partial Regex Parenthetical();
    [GeneratedRegex(@"^[\s\-*•·▪◦●○▢□☐✓✔➤>]+")] private static partial Regex ListMarker();
    [GeneratedRegex(@"(\d)-(ounce|ounces|oz|pound|pounds|lb|inch|gram|grams|g)\b", RegexOptions.IgnoreCase)] private static partial Regex HyphenSize();
    [GeneratedRegex(@"^\s*[\d\s./½¼¾⅓⅔⅛⅜⅝⅞-]+\s*$")] private static partial Regex LeadingAmountOnly();
    [GeneratedRegex(@"[:;]")] private static partial Regex ParenSeparator();
    [GeneratedRegex(@"^\d+$")] private static partial Regex WholeNumber();
    [GeneratedRegex(@"([A-Za-z.]+)\s*/\s*(\d+(?:\.\d+)?\s*(?:g|grams?|ml|milliliters?|oz|ounces?))\b", RegexOptions.IgnoreCase)] private static partial Regex SlashWeight();
    /// <summary>"1. " or "2) " only when another amount follows, so "2) eggs"-style lines aren't stripped of their count by accident.</summary>
    [GeneratedRegex(@"^\d{1,2}[.)]\s+(?=[\d½¼¾⅓⅔⅛⅜⅝⅞])")] private static partial Regex NumberedMarker();
    [GeneratedRegex(@"^(?:about|approx\.?|approximately|roughly|around|~)\s*", RegexOptions.IgnoreCase)] private static partial Regex Approximately();
    [GeneratedRegex(@"\s{2,}")] private static partial Regex MultiSpace();
    [GeneratedRegex(@"^(\d+(?:[.,]\d+)?)([a-zA-Z]+\.?)$")] private static partial Regex GluedAmountUnit();
    [GeneratedRegex(@"^(\d+)/(\d+)$")] private static partial Regex FractionToken();
    [GeneratedRegex(@"^([\d./½¼¾⅓⅔]+)-([\d./½¼¾⅓⅔]+)$")] private static partial Regex RangeToken();
    [GeneratedRegex(@"\b(\d+)-(\d+/\d+)\b")] private static partial Regex MixedHyphen();
    [GeneratedRegex(@"^(?:(?:ok(?:ay)?|so|um+|uh+)[, ]+)?(?:i(?:'ve|\s+have)?\s+(?:just\s+)?(?:had|ate|eaten|drank|drunk|consumed)|(?:please\s+)?(?:log|add|track|record))\s+", RegexOptions.IgnoreCase)] private static partial Regex LeadingVerb();
    [GeneratedRegex(@"\b(hundred|thousand)\s+and\s+(?=\w)", RegexOptions.IgnoreCase)] private static partial Regex HundredAnd();
    [GeneratedRegex(@"^\d{2,3}/\d{2,3}$")] private static partial Regex PercentRatio();
    [GeneratedRegex(@"\s*(?:,|;|\band\b(?!\s+(?:a\s+)?(?:half|quarter|third)\b)|\bwith\b|\bplus\b|\n)\s*", RegexOptions.IgnoreCase)] private static partial Regex ItemSeparator();
}
