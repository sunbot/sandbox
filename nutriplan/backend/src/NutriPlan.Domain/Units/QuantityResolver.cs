using System.Text.RegularExpressions;
using NutriPlan.Domain.Foods;

namespace NutriPlan.Domain.Units;

public enum ResolutionMethod { Mass, VolumeViaPortion, NamedPortion, DefaultPortion, Unresolved }

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
    private static readonly string[] DefaultPortionHints = ["serving", "medium", "piece", "item", "each", "whole", "unit", "large"];

    public static ResolvedQuantity Resolve(Food food, double amount, string? unitText) =>
        Resolve(food.Portions, amount, unitText, food.Name);

    public static ResolvedQuantity Resolve(IReadOnlyList<FoodPortion> portions, double amount, string? unitText, string? foodName = null)
    {
        if (amount < 0) throw new ArgumentOutOfRangeException(nameof(amount));
        var unit = Units.Find(unitText);

        if (unit is { Kind: UnitKind.Mass })
            return new(unit.ToBaseAmount(amount), ResolutionMethod.Mass, $"{amount:0.##} {unit.Name} = {unit.ToBaseAmount(amount):0.#} g");

        if (unit is { Kind: UnitKind.Volume })
        {
            foreach (var portion in portions)
            {
                var portionUnit = LeadingVolumeUnit(portion.Description);
                if (portionUnit is null) continue;
                var mlPerPortionUnit = portionUnit.ToBase;
                var gramsPerMl = portion.GramsPerUnit / mlPerPortionUnit;
                var grams = unit.ToBaseAmount(amount) * gramsPerMl;
                return new(grams, ResolutionMethod.VolumeViaPortion,
                    $"{amount:0.##} {unit.Name} ≈ {grams:0.#} g (USDA: 1 {portion.Description} = {portion.GramsPerUnit:0.#} g)", portion);
            }
            return new(null, ResolutionMethod.Unresolved,
                $"No volume measure is known for this food, so {amount:0.##} {unit.Name} can't be converted to grams accurately. Weigh it or pick a portion.");
        }

        // Named portion ("slice", "large", "clove", "can") — match the portion description.
        if (!string.IsNullOrWhiteSpace(unitText))
        {
            var wanted = Singular(unitText.Trim().ToLowerInvariant());
            var match = portions.FirstOrDefault(p => Words(p.Description).Contains(wanted));
            if (match is not null)
                return new(amount * match.GramsPerUnit, ResolutionMethod.NamedPortion,
                    $"{amount:0.##} × {match.Description} ({match.GramsPerUnit:0.#} g each)", match);
            return new(null, ResolutionMethod.Unresolved, $"\"{unitText}\" isn't a known measure for this food. Pick a portion or enter grams.");
        }

        // No unit at all: "2 eggs" → the food's natural single item.
        // US recipes and labels assume large eggs.
        var hints = foodName is not null && foodName.StartsWith("egg", StringComparison.OrdinalIgnoreCase)
            ? DefaultPortionHints.Prepend("large")
            : DefaultPortionHints;
        var fallback = hints
            .Select(h => portions.FirstOrDefault(p => Words(p.Description).Contains(h) && LeadingVolumeUnit(p.Description) is null))
            .FirstOrDefault(p => p is not null)
            ?? portions.FirstOrDefault(p => LeadingVolumeUnit(p.Description) is null);

        if (fallback is not null)
            return new(amount * fallback.GramsPerUnit, ResolutionMethod.DefaultPortion,
                $"{amount:0.##} × {fallback.Description} ({fallback.GramsPerUnit:0.#} g each)", fallback);

        return new(null, ResolutionMethod.Unresolved, "Amount has no unit and this food has no standard portion. Enter grams.");
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

    [GeneratedRegex(@"[^a-z]+")]
    private static partial Regex WordSplit();
}
