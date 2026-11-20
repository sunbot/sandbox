namespace NutriPlan.Domain.Units;

public enum UnitKind { Mass, Volume, Count }

public sealed record Unit(string Name, UnitKind Kind, double ToBase, params string[] Aliases)
{
    /// <summary>Converts an amount of this unit into grams (mass) or millilitres (volume).</summary>
    public double ToBaseAmount(double amount) => amount * ToBase;
}

/// <summary>Known measurement units. Base units are grams (mass) and millilitres (volume); US customary volumes.</summary>
public static class Units
{
    public static readonly Unit Gram = new("g", UnitKind.Mass, 1, "g", "gram", "grams", "gr", "gm", "gms");
    public static readonly Unit Kilogram = new("kg", UnitKind.Mass, 1000, "kg", "kilo", "kilos", "kilogram", "kilograms");
    public static readonly Unit Milligram = new("mg", UnitKind.Mass, 0.001, "mg", "milligram", "milligrams");
    public static readonly Unit Ounce = new("oz", UnitKind.Mass, 28.349523125, "oz", "ounce", "ounces", "onz");
    public static readonly Unit Pound = new("lb", UnitKind.Mass, 453.59237, "lb", "lbs", "pound", "pounds", "#");

    public static readonly Unit Milliliter = new("ml", UnitKind.Volume, 1, "ml", "mls", "milliliter", "milliliters", "millilitre", "millilitres", "cc");
    public static readonly Unit Liter = new("l", UnitKind.Volume, 1000, "l", "liter", "liters", "litre", "litres");
    public static readonly Unit Teaspoon = new("tsp", UnitKind.Volume, 4.92892159375, "tsp", "tsps", "t", "teaspoon", "teaspoons", "tspn");
    public static readonly Unit Tablespoon = new("tbsp", UnitKind.Volume, 14.78676478125, "tbsp", "tbsps", "tbs", "tbl", "tbl.", "T", "tablespoon", "tablespoons", "tblsp");
    public static readonly Unit FluidOunce = new("fl oz", UnitKind.Volume, 29.5735295625, "fl oz", "floz", "fl. oz", "fl. oz.", "fluid ounce", "fluid ounces");
    public static readonly Unit Cup = new("cup", UnitKind.Volume, 236.5882365, "cup", "cups", "c", "c.");
    public static readonly Unit Pint = new("pint", UnitKind.Volume, 473.176473, "pint", "pints", "pt");
    public static readonly Unit Quart = new("quart", UnitKind.Volume, 946.352946, "quart", "quarts", "qt");
    public static readonly Unit Gallon = new("gallon", UnitKind.Volume, 3785.411784, "gallon", "gallons", "gal");
    /// <summary>Kitchen conventions: a pinch is 1/16 tsp and a dash 1/8 tsp.</summary>
    public static readonly Unit Pinch = new("pinch", UnitKind.Volume, 4.92892159375 / 16, "pinch", "pinches");
    public static readonly Unit Dash = new("dash", UnitKind.Volume, 4.92892159375 / 8, "dash", "dashes");

    public static IReadOnlyList<Unit> All { get; } =
        [Gram, Kilogram, Milligram, Ounce, Pound, Milliliter, Liter, Teaspoon, Tablespoon, FluidOunce, Cup, Pint, Quart, Gallon, Pinch, Dash];

    private static readonly Dictionary<string, Unit> CaseSensitive = new(StringComparer.Ordinal);
    private static readonly Dictionary<string, Unit> CaseInsensitive = new(StringComparer.OrdinalIgnoreCase);

    static Units()
    {
        foreach (var unit in All)
        foreach (var alias in unit.Aliases.Append(unit.Name))
        {
            // "T" (tablespoon) vs "t" (teaspoon) is the classic recipe ambiguity: keep exact-case for single letters.
            if (alias.Length == 1) CaseSensitive[alias] = unit;
            else CaseInsensitive.TryAdd(alias, unit);
        }
    }

    public static Unit? Find(string? text)
    {
        if (string.IsNullOrWhiteSpace(text)) return null;
        var t = text.Trim();
        if (CaseSensitive.TryGetValue(t, out var exact)) return exact;
        if (CaseInsensitive.TryGetValue(t, out var unit)) return unit;
        var trimmed = t.TrimEnd('.');
        return trimmed != t ? Find(trimmed) : null;
    }
}
