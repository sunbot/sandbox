using System.Text.RegularExpressions;
using NutriPlan.Domain.Foods;

namespace NutriPlan.Domain.Units;

public enum ResolutionMethod { Mass, VolumeViaPortion, NamedPortion, DefaultPortion, Unresolved, Volume }

public sealed record ResolvedQuantity(double? Grams, ResolutionMethod Method, string Explanation, FoodPortion? Portion = null)
{
    public bool IsResolved => Grams is not null;
}

/// <summary>
/// Turns "2 tbsp", "1 large", "half a pound" (amount + unit text) into grams for a specific food,
/// using the food's own portion data (USDA measures how much a cup of *that* food weighs).
/// Never guesses a density: if it can't be resolved from data the result is Unresolved and the UI asks.
/// </summary>
public static partial class QuantityResolver
{
    private static readonly HashSet<string> SizeWords = ["small", "medium", "large", "extra-large", "jumbo", "regular"];

    /// <summary>
    /// Count words that don't name a portion ("2 pieces of toast", "3 items"). If the food has a portion called exactly that
    /// it's used; otherwise they mean "this many of the food's standard item", from the food's own USDA portions.
    /// </summary>
    private static readonly HashSet<string> GenericCountWords = ["piece", "pc", "pcs", "item", "unit", "each", "portion", "whole"];

    private static readonly string[] DefaultPortionHints = ["medium", "whole", "regular", "large", "each", "item", "unit", "serving", "piece"];

    /// <summary>
    /// For a <see cref="NutrientBasis.Volume"/> food the result's "grams" are millilitres: volumes convert exactly, named
    /// portions use their labelled ml, and weights can't be converted (no density is invented).
    /// </summary>
    public static ResolvedQuantity Resolve(Food food, double amount, string? unitText)
    {
        if (!food.IsVolume) return Resolve(food.Portions, amount, unitText, food.Name);
        if (amount < 0) throw new ArgumentOutOfRangeException(nameof(amount));
        var unit = Units.Find(unitText);
        if (unit is { Kind: UnitKind.Volume })
            return new(unit.ToBaseAmount(amount), ResolutionMethod.Volume, $"{amount:0.##} {unit.Name} = {unit.ToBaseAmount(amount):0.#} ml");
        if (unit is { Kind: UnitKind.Mass })
            return new(null, ResolutionMethod.Unresolved,
                $"This drink's label is per 100 ml, so {amount:0.##} {unit.Name} can't be converted without its density. Use ml or a serving.");
        // Named or default portion: the portion's amount is in ml for a volume food.
        var r = Resolve(food.Portions, amount, unitText, food.Name);
        return r.Grams is null ? r : r with { Explanation = r.Explanation.Replace(" g each", " ml each").Replace(" g)", " ml)").Replace(" g", " ml") };
    }

    public static ResolvedQuantity Resolve(IReadOnlyList<FoodPortion> portions, double amount, string? unitText, string? foodName = null)
    {
        if (amount < 0) throw new ArgumentOutOfRangeException(nameof(amount));
        var unit = Units.Find(unitText);

        if (unit is { Kind: UnitKind.Mass })
            return new(unit.ToBaseAmount(amount), ResolutionMethod.Mass, $"{amount:0.##} {unit.Name} = {unit.ToBaseAmount(amount):0.#} g");

        if (unit is { Kind: UnitKind.Volume })
        {
            // Use the measure closest in size to what was asked (a cup weight for "2 cups", not a teaspoon × 96)
            // and the plainest one ("cup" over "cup, packed"), to keep rounding error small.
            var requestedMl = unit.ToBaseAmount(amount);
            var best = portions
                .Select(p => (Portion: p, Unit: LeadingVolumeUnit(p.Description)))
                .Where(x => x.Unit is not null)
                .OrderBy(x => Math.Abs(Math.Log(Math.Max(requestedMl, 0.01) / (x.Unit!.ToBase * Math.Max(x.Portion.Amount, 0.01)))))
                .ThenByDescending(x => Shelled().IsMatch(x.Portion.Description)) // recipes measure nuts shelled
                .ThenBy(x => x.Portion.Description.Length)
                .FirstOrDefault();
            if (best.Unit is not null)
            {
                var gramsPerMl = best.Portion.GramsPerUnit / best.Unit.ToBase;
                var grams = requestedMl * gramsPerMl;
                return new(grams, ResolutionMethod.VolumeViaPortion,
                    $"{amount:0.##} {unit.Name} ≈ {grams:0.#} g (USDA: 1 {best.Portion.Description} = {best.Portion.GramsPerUnit:0.#} g)", best.Portion);
            }
            return new(null, ResolutionMethod.Unresolved,
                $"No volume measure is known for this food, so {amount:0.##} {unit.Name} can't be converted to grams accurately. Weigh it or pick a portion.");
        }

        // Named portion ("slice", "large", "clove", "can") — match the portion description.
        if (!string.IsNullOrWhiteSpace(unitText))
        {
            // A measure named by its whole description ("100-calorie package", as FoodMeasures offers it): exactly that
            // portion, unless several portions share the name with different weights.
            if (ExactPortion(portions, unitText) is { } exact)
                return new(amount * exact.GramsPerUnit, ResolutionMethod.NamedPortion,
                    $"{amount:0.##} × {exact.Description} ({exact.GramsPerUnit:0.#} g each)", exact);
            var wanted = Singular(unitText.Trim().ToLowerInvariant());
            // Several can match ("slice, snack-size", "medium or regular slice"): prefer the regular one.
            var match = portions
                // "1 piece" is never "cup (1\" pieces)": a count word doesn't match a volume measure.
                .Where(p => Words(p.Description).Contains(wanted) && LeadingVolumeUnit(p.Description) is null)
                .OrderByDescending(p => PlainnessScore(p.Description, wanted))
                .ThenBy(p => p.Description.Length)
                .FirstOrDefault();
            if (match is not null)
                return new(amount * match.GramsPerUnit, ResolutionMethod.NamedPortion,
                    $"{amount:0.##} × {match.Description} ({match.GramsPerUnit:0.#} g each)", match);
            // A size word with no matching size listed ("1 medium" when USDA only has "1 banana"): use the standard item.
            if (!SizeWords.Contains(wanted) && !GenericCountWords.Contains(wanted))
                return new(null, ResolutionMethod.Unresolved, $"\"{unitText}\" isn't a known measure for this food. Pick a portion or enter grams.");
        }

        // A size word ("1 medium sweet potato") asks for the food itself in that size: never a package of it.
        var sizeAsked = !string.IsNullOrWhiteSpace(unitText) && SizeWords.Contains(Singular(unitText.Trim().ToLowerInvariant()));

        // No unit at all: "2 eggs" → the food's natural single item.
        // US recipes and labels assume large eggs.
        var hints = foodName is not null && foodName.StartsWith("egg", StringComparison.OrdinalIgnoreCase)
            ? DefaultPortionHints.Prepend("large")
            : DefaultPortionHints;
        var usable = portions.Where(p => LeadingVolumeUnit(p.Description) is null && !Words(p.Description).Contains("inch")
            && !(sizeAsked && Words(p.Description).Overlaps(ContainerWords))).ToList();

        // Best default: a portion named after the food itself ("1 banana" for "Banana, raw").
        var nameWord = foodName is null ? null : Singular(WordSplit().Split(foodName.ToLowerInvariant()).FirstOrDefault(w => w.Length > 2) ?? "");
        // Never a part or a variety as "one": a slice, ring or leaf, or "grape tomato" for "Tomatoes, raw".
        // If every portion is a part (bread: only slices), the part is the item, and the usual size hints pick among them.
        var whole = usable.Where(p => !Words(p.Description).Overlaps(PartOrVarietyWords)).ToList();
        var pool = whole.Count > 0 ? whole : usable;
        var fallback = (nameWord is null ? null : pool.FirstOrDefault(p => Words(p.Description).Contains(nameWord)))
            ?? hints.Select(h => pool.FirstOrDefault(p => Words(p.Description).Contains(h))).FirstOrDefault(p => p is not null)
            ?? pool.FirstOrDefault();

        if (fallback is not null)
            return new(amount * fallback.GramsPerUnit, ResolutionMethod.DefaultPortion,
                string.IsNullOrWhiteSpace(unitText)
                    ? $"{amount:0.##} × {fallback.Description} ({fallback.GramsPerUnit:0.#} g each)"
                    : $"No \"{unitText}\" size listed; using {amount:0.##} × {fallback.Description} ({fallback.GramsPerUnit:0.#} g each)", fallback);

        return new(null, ResolutionMethod.Unresolved, "Amount has no unit and this food has no standard portion. Enter grams.");
    }

    /// <summary>
    /// Only number-led portions that FoodMeasures names by their phrase ("100 calorie package" → "100-calorie package"):
    /// any other unit text resolves exactly as before (word matching), so "slices" still means the plain "slice" portion.
    /// </summary>
    private static FoodPortion? ExactPortion(IReadOnlyList<FoodPortion> portions, string unitText)
    {
        var u = unitText.Trim();
        var hits = portions.Where(p => p.GramsPerUnit > 0 && LeadingVolumeUnit(p.Description) is null
            && FoodMeasures.PhraseLabel(p.Description) is { } label
            && (string.Equals(p.Description.Trim(), u, StringComparison.OrdinalIgnoreCase)
                || string.Equals(label, u, StringComparison.OrdinalIgnoreCase)
                || string.Equals(FoodMeasures.PluralOfPhrase(label), u, StringComparison.OrdinalIgnoreCase)))
            .ToList();
        return hits.Count > 0 && hits.All(h => Math.Abs(h.GramsPerUnit - hits[0].GramsPerUnit) < 1e-9) ? hits[0] : null;
    }

    private static readonly string[] RegularWords = ["regular", "medium", "standard", "average"];
    private static readonly string[] OddWords = ["snack", "thin", "small", "mini", "miniature", "baby", "crust", "bite", "cocktail", "thick", "large"];

    /// <summary>Packages: a fine "one" for "1 yogurt", never for "1 medium" of something.</summary>
    private static readonly HashSet<string> ContainerWords =
        ["can", "jar", "package", "pkg", "container", "box", "bottle", "bag", "carton", "packet", "pouch", "tub", "tray"];

    /// <summary>Portions that are a piece of the food or a different variety, not "one" of it.</summary>
    private static readonly HashSet<string> PartOrVarietyWords =
        ["slice", "ring", "strip", "wedge", "leaf", "sprig", "grape", "cherry", "plum", "italian", "cube", "floret", "segment", "section", "spear", "stalk", "chopped", "nlea"];

    private static int PlainnessScore(string description, string wanted)
    {
        var words = Words(description);
        var score = 0;
        if (words.Count == 1) score += 4;
        if (RegularWords.Any(words.Contains)) score += 3;
        if (OddWords.Any(w => words.Contains(w) && w != wanted)) score -= 2;
        if (SizeWords.Contains(wanted) && words.Overlaps(PartOrVarietyWords)) score -= 6; // "1 medium" is the whole item, not "slice, medium"
        return score;
    }

    /// <summary>Finds a volume unit at the start of a USDA portion description, e.g. "cup, chopped" or "tbsp".</summary>
    public static Unit? LeadingVolumeUnit(string description)
    {
        var first = LeadingWord().Match(description);
        if (!first.Success) return null;
        var candidate = first.Value;
        if (candidate.Equals("fl", StringComparison.OrdinalIgnoreCase) &&
            description.StartsWith("fl oz", StringComparison.OrdinalIgnoreCase))
            return Units.FluidOunce;
        var unit = Units.Find(candidate);
        // Single-letter aliases are too ambiguous inside free-text descriptions.
        return unit is { Kind: UnitKind.Volume } && candidate.Length > 1 ? unit : null;
    }

    private static HashSet<string> Words(string text) =>
        WordSplit().Split(text.ToLowerInvariant()).Where(w => w.Length > 0).Select(Singular).ToHashSet();

    private static string Singular(string word) =>
        word.EndsWith("ves") ? word[..^3] + "f" :
        word.EndsWith("ies") ? word[..^3] + "y" :
        word.EndsWith("es") && (word.EndsWith("ches") || word.EndsWith("shes") || word.EndsWith("oes")) ? word[..^2] :
        word.EndsWith('s') && !word.EndsWith("ss") ? word[..^1] : word;

    [GeneratedRegex(@"^[A-Za-z]+\.?")]
    private static partial Regex LeadingWord();

    [GeneratedRegex(@"without shell|shelled|kernels", RegexOptions.IgnoreCase)]
    private static partial Regex Shelled();

    /// <summary>A default portion that is only a piece of the food (a ring, strip or "piece"), a weak guess for "1 pepper".</summary>
    public static bool IsPartGuess(ResolvedQuantity q) =>
        q is { Method: ResolutionMethod.DefaultPortion, Portion: { } p } && Words(p.Description).Overlaps(PartOrVarietyWords.Append("piece"));

    [GeneratedRegex(@"[^a-z]+")]
    private static partial Regex WordSplit();
}
