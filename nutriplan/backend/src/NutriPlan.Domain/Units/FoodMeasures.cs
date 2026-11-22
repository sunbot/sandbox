using System.Text.RegularExpressions;
using NutriPlan.Domain.Foods;

namespace NutriPlan.Domain.Units;

public enum MeasureKind { Count, Volume, Mass }

/// <summary>
/// One way to measure a food: <see cref="Unit"/> is what's sent back to log it (and what <see cref="QuantityResolver"/>
/// resolves), <see cref="BasePerUnit"/> is grams (or ml for a drink measured by volume) in one of it, and
/// <see cref="Source"/> is the USDA/label wording it comes from (null for exact units such as g or oz).
/// </summary>
/// <see cref="Origin"/> is set when the portion was borrowed from another USDA record (see <see cref="Foods.EquivalentPortions"/>).
public sealed record FoodMeasure(string Unit, string Label, string Plural, double BasePerUnit, MeasureKind Kind, string? Source, bool Countable, string? Origin = null);

/// <summary>
/// The measures a food can really be logged in. Every entry is derived from the food's own data or an exact unit
/// conversion, and is computed by the same <see cref="QuantityResolver"/> that turns a logged amount into grams, so a
/// measure the app offers always resolves to the same weight on the server. No density or weight is ever invented:
/// a solid food gets cups/tablespoons only when USDA measured a volume of that food, and a drink measured per 100 ml never
/// gets grams.
/// </summary>
public static partial class FoodMeasures
{
    private static readonly HashSet<string> Skip =
    [
        "of", "and", "or", "extra", "with", "without", "whole", "nlea", "fl", "oz", "g", "inch", "in", "dia", "diameter", "long", "approx", "about",
        "to", "per", "x", "yield", "raw", "cooked", "edible", "portion", "chopped", "sliced", "diced", "shredded", "packed",
        "calorie", "kcal", "cal", "nfs", // "100 calorie package" is a package, never a "calorie"; NFS = "not further specified"
    ];
    private static readonly HashSet<string> SizeWords = ["small", "medium", "large", "extra-large", "jumbo", "regular", "mini"];

    public static IReadOnlyList<FoodMeasure> For(Food food)
    {
        var list = new List<FoodMeasure>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        void Add(FoodMeasure m)
        {
            if (m.BasePerUnit > 0 && seen.Add(m.Unit)) list.Add(m);
        }

        // 1) Named portions from the food's own data ("almond", "large", "slice", "container", "scoop", "serving").
        foreach (var p in food.Portions.Where(p => p.GramsPerUnit > 0))
        {
            if (QuantityResolver.LeadingVolumeUnit(p.Description) is not null) continue; // volume measures are offered as cup/tbsp below
            // "oz, NFS", "oz, without shell", "lb, boneless" are weights (offered as g/oz), not an item called "nfs" or "shell".
            if (Units.Find(LeadingToken().Match(p.Description).Value) is { Kind: UnitKind.Mass }) continue;
            // Only the first word names the measure ("slice", "large", "container", "scoop"); later words describe a kind of
            // that portion ("slice, thin"), which on its own would be misleading ("2 thin"). A portion whose name resolves to a
            // different (plainer) portion isn't offered separately.
            // A description led by a number qualifies the measure ("100 calorie package", "1-3 ring thin pretzel"): its
            // first word isn't a measure on its own, so the whole phrase names it.
            var phrase = PhraseLabel(p.Description);
            var word = phrase ?? Words(p.Description).FirstOrDefault();
            if (word is null) continue;
            var r = QuantityResolver.Resolve(food, 1, word);
            if (r is not { Method: ResolutionMethod.NamedPortion, Grams: { } g, Portion: { } match } || !ReferenceEquals(match, p)) continue;
            Add(new FoodMeasure(word, word, phrase is null ? PluralOf(word) : PluralOfPhrase(phrase), Math.Round(g, 3), MeasureKind.Count, p.Description, true, p.Origin));
        }

        // 2) Household volumes: exact for a drink; for a solid food only through a volume USDA measured for it.
        foreach (var unit in new[] { Units.Cup, Units.Tablespoon, Units.Teaspoon, Units.FluidOunce })
        {
            if (!food.IsVolume && unit == Units.FluidOunce) continue; // "fl oz of almonds" is never how anyone measures a solid
            var r = QuantityResolver.Resolve(food, 1, unit.Name);
            if (r.Grams is not { } g || g <= 0) continue;
            var via = r.Method == ResolutionMethod.VolumeViaPortion ? r.Portion : null;
            Add(new FoodMeasure(unit.Name, unit.Name, unit == Units.Cup ? "cups" : unit.Name, Math.Round(g, 3), MeasureKind.Volume,
                via?.Description, false, via?.Origin));
        }
        if (food.IsVolume) Add(new FoodMeasure("ml", "ml", "ml", 1, MeasureKind.Volume, null, false));

        // 3) Exact weights (never for a drink measured per 100 ml: that would need its density).
        if (!food.IsVolume)
        {
            Add(new FoodMeasure("g", "g", "g", 1, MeasureKind.Mass, null, false));
            Add(new FoodMeasure("oz", "oz", "oz", Math.Round(Units.Ounce.ToBase, 6), MeasureKind.Mass, null, false));
        }
        return list;
    }

    /// <summary>The measure an existing amount/unit (e.g. a logged entry's) corresponds to, if any.</summary>
    public static FoodMeasure? Match(IReadOnlyList<FoodMeasure> measures, string? unit)
    {
        if (string.IsNullOrWhiteSpace(unit)) return null;
        var u = unit.Trim();
        var exact = measures.FirstOrDefault(m => string.Equals(m.Unit, u, StringComparison.OrdinalIgnoreCase) || string.Equals(m.Plural, u, StringComparison.OrdinalIgnoreCase));
        if (exact is not null) return exact;
        var known = Units.Find(u);
        return known is null ? null : measures.FirstOrDefault(m => string.Equals(m.Unit, known.Name, StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>
    /// The name for a portion whose description starts with a number that qualifies it: "100 calorie package" →
    /// "100-calorie package", "1-3 ring thin pretzel" stays as it is. Null for any other description (those are named by
    /// their first word), for a number followed by a unit ("6 oz container" is a container) and for a phrase that ends in
    /// no measure ("2-1/4\" dia"). The original description is kept as the measure's source.
    /// </summary>
    public static string? PhraseLabel(string description)
    {
        var text = Space().Replace(Paren().Replace(description, " "), " ").Trim().ToLowerInvariant();
        var m = LeadingQualifier().Match(text);
        if (!m.Success) return null;
        var (number, qualifier, rest) = (m.Groups["n"].Value, m.Groups["q"].Value, m.Groups["rest"].Value.Trim());
        if (Units.Find(qualifier) is not null || qualifier is "inch" or "in" or "dia") return null;
        var last = Singular(WordRx().Matches(rest).LastOrDefault()?.Value ?? "");
        if (last.Length < 2 || Skip.Contains(last) || Units.Find(last) is not null) return null;
        return number.Contains('-') || number.Contains('/') ? $"{number} {qualifier} {rest}" : $"{number}-{qualifier} {rest}";
    }

    /// <summary>"100-calorie package" → "100-calorie packages": the last word carries the plural.</summary>
    public static string PluralOfPhrase(string phrase)
    {
        var i = phrase.LastIndexOf(' ');
        return i < 0 ? PluralOf(phrase) : phrase[..(i + 1)] + PluralOf(phrase[(i + 1)..]);
    }

    public static string PluralOf(string word) =>
        SizeWords.Contains(word) || word.EndsWith('s') ? word :
        word.EndsWith('y') && word.Length > 2 && !"aeiou".Contains(word[^2]) ? word[..^1] + "ies" :
        word.EndsWith("ch") || word.EndsWith("sh") || word.EndsWith('x') ? word + "es" :
        word + "s";

    private static IEnumerable<string> Words(string description)
    {
        var head = Paren().Replace(description, " ").ToLowerInvariant();
        foreach (var raw in WordRx().Matches(head).Select(m => m.Value))
        {
            var w = Singular(raw);
            if (w.Length < 2 || Skip.Contains(w) || Units.Find(w) is not null) continue;
            yield return w;
        }
    }

    private static string Singular(string w) =>
        w.EndsWith("ies") && w.Length > 4 ? w[..^3] + "y" :
        w.EndsWith("ches") || w.EndsWith("shes") ? w[..^2] :
        w.EndsWith('s') && !w.EndsWith("ss") && w.Length > 3 ? w[..^1] : w;

    [GeneratedRegex(@"\([^)]*\)")] private static partial Regex Paren();
    [GeneratedRegex(@"\s+")] private static partial Regex Space();
    [GeneratedRegex(@"^[A-Za-z]+")] private static partial Regex LeadingToken();
    [GeneratedRegex(@"^(?<n>\d+(?:[.\-/]\d+)*)[\s-]+(?<q>[a-z]+)\s+(?<rest>[a-z][a-z\- ]*)$")] private static partial Regex LeadingQualifier();
    [GeneratedRegex(@"[a-z][a-z\-]*")] private static partial Regex WordRx();
}
