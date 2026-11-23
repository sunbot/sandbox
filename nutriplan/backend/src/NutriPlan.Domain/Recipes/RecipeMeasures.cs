using NutriPlan.Domain.Units;

namespace NutriPlan.Domain.Recipes;

/// <summary>How much of a recipe, in servings, with how that amount was read.</summary>
public sealed record RecipeAmount(double? Servings, double? Grams, string Explanation)
{
    public bool IsResolved => Servings is > 0;
}

/// <summary>
/// The measures a recipe can be logged, planned or used in. Always servings; by weight only when you entered the finished
/// weight, and by volume only when you entered the finished volume (nothing is estimated from ingredients). Each measure's
/// <see cref="FoodMeasure.BasePerUnit"/> is servings per unit, so the app's quantity picker converts recipes as it does foods.
/// </summary>
public static class RecipeMeasures
{
    public const string Serving = "serving";

    private static readonly Unit[] Weights = [Units.Units.Gram, Units.Units.Ounce];
    private static readonly Unit[] Volumes = [Units.Units.Cup, Units.Units.Tablespoon, Units.Units.FluidOunce, Units.Units.Milliliter];

    public static IReadOnlyList<FoodMeasure> For(Recipe r)
    {
        var list = new List<FoodMeasure> { new(Serving, Serving, "servings", 1, MeasureKind.Count, $"1 of {Fmt(r.Servings)} servings", true) };
        if (r.MlPerServing is { } ml)
            list.AddRange(Volumes.Select(u => new FoodMeasure(u.Name, u.Name, u.Name == "cup" ? "cups" : u.Name, u.ToBase / ml, MeasureKind.Volume,
                $"finished volume {Fmt(r.FinishedVolumeMl!.Value)} ml", false)));
        if (r.GramsPerServing is { } g)
            list.AddRange(Weights.Select(u => new FoodMeasure(u.Name, u.Name, u.Name, u.ToBase / g, MeasureKind.Mass,
                $"finished weight {Fmt(r.CookedWeightGrams!.Value)} g", false)));
        return list;
    }

    /// <summary>Converts an amount of this recipe to servings, only through the servings, finished weight or finished volume you set.</summary>
    public static RecipeAmount Resolve(Recipe r, double amount, string? unit)
    {
        if (!double.IsFinite(amount) || amount <= 0) return new(null, null, "Enter an amount greater than zero.");
        var text = unit?.Trim() ?? "";
        if (text.Length == 0 || IsServing(text))
        {
            var g = r.GramsPerServing is { } gps ? amount * gps : (double?)null;
            return new(amount, g, $"{Fmt(amount)} {(amount == 1 ? "serving" : "servings")} of {Fmt(r.Servings)}");
        }
        var u = Units.Units.Find(text);
        if (u is { Kind: UnitKind.Mass })
            return r.GramsPerServing is { } gps
                ? new(amount * u.ToBase / gps, amount * u.ToBase, $"{Fmt(amount)} {u.Name} of a {Fmt(r.CookedWeightGrams!.Value)} g finished dish")
                : new(null, null, $"Add the finished weight of \"{r.Name}\" to use it by weight.");
        if (u is { Kind: UnitKind.Volume })
            return r.MlPerServing is { } mps
                ? new(amount * u.ToBase / mps, r.GramsPerServing is { } gps2 ? amount * u.ToBase / mps * gps2 : null,
                    $"{Fmt(amount)} {u.Name} of {Fmt(r.FinishedVolumeMl!.Value)} ml finished")
                : new(null, null, $"Add the finished volume of \"{r.Name}\" to use it in cups or ml.");
        return new(null, null, $"\"{text}\" isn't a measure for a recipe. Use servings{(r.GramsPerServing is not null ? ", grams" : "")}{(r.MlPerServing is not null ? ", cups" : "")}.");
    }

    public static bool IsServing(string unit)
    {
        var t = unit.Trim().ToLowerInvariant();
        return t is "serving" or "servings" or "portion" or "portions" or "serve" or "serves";
    }

    private static string Fmt(double v) => v.ToString("0.##", System.Globalization.CultureInfo.InvariantCulture);
}
