using System.Text.RegularExpressions;
using NutriPlan.Domain.Foods;

namespace NutriPlan.Domain.Units;

public enum MeasureKind { Count, Volume, Mass }

/// <summary>
/// One way to measure a food: <see cref="Unit"/> is what's sent back to log it (and what <see cref="QuantityResolver"/>
/// resolves), <see cref="BasePerUnit"/> is grams (or ml for a drink measured by volume) in one of it, and
/// <see cref="Source"/> is the USDA/label wording it comes from (null for exact units such as g or oz).
/// </summary>
public sealed record FoodMeasure(string Unit, string Label, string Plural, double BasePerUnit, MeasureKind Kind, string? Source, bool Countable);

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
        "to", "per", "x", "yield", "raw", "cooked", "edible", "portion", "edible", "chopped", "sliced", "diced", "shredded", "packed",
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
            // Only the first word names the measure ("slice", "large", "container", "scoop"); later words describe a kind of
            // that portion ("slice, thin"), which on its own would be misleading ("2 thin"). A portion whose name resolves to a
            // different (plainer) portion isn't offered separately.
            var word = Words(p.Description).FirstOrDefault();
            if (word is null) continue;
            var r = QuantityResolver.Resolve(food, 1, word);
            if (r is not { Method: ResolutionMethod.NamedPortion, Grams: { } g, Portion: { } match } || !ReferenceEquals(match, p)) continue;
            Add(new FoodMeasure(word, word, PluralOf(word), Math.Round(g, 3), MeasureKind.Count, p.Description, true));
        }

        // 2) Household volumes: exact for a drink; for a solid food only through a volume USDA measured for it.
        foreach (var unit in new[] { Units.Cup, Units.Tablespoon, Units.Teaspoon, Units.FluidOunce })
        {
            if (!food.IsVolume && unit == Units.FluidOunce) continue; // "fl oz of almonds" is never how anyone measures a solid
            var r = QuantityResolver.Resolve(food, 1, unit.Name);
            if (r.Grams is not { } g || g <= 0) continue;
            Add(new FoodMeasure(unit.Name, unit.Name, unit == Units.Cup ? "cups" : unit.Name, Math.Round(g, 3), MeasureKind.Volume,
                r.Method == ResolutionMethod.VolumeViaPortion ? r.Portion?.Description : null, false));
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
    [GeneratedRegex(@"[a-z][a-z\-]*")] private static partial Regex WordRx();
}
