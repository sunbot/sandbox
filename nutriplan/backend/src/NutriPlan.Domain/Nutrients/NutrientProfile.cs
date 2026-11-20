using System.Collections.ObjectModel;

namespace NutriPlan.Domain.Nutrients;

/// <summary>
/// An immutable bag of nutrient amounts keyed by <see cref="NutrientIds"/>.
/// Used both for "per 100 g" food data and for computed totals (a meal, a day, a recipe serving).
/// A missing key means "unknown", which is different from zero; totals keep track of that
/// through <see cref="Add"/> (unknown + known = known, so totals are lower bounds).
/// </summary>
public sealed class NutrientProfile : IEquatable<NutrientProfile>
{
    public static readonly NutrientProfile Empty = new(new Dictionary<int, double>());

    private readonly IReadOnlyDictionary<int, double> _amounts;

    public NutrientProfile(IDictionary<int, double> amounts)
    {
        _amounts = new ReadOnlyDictionary<int, double>(new Dictionary<int, double>(amounts));
    }

    public IReadOnlyDictionary<int, double> Amounts => _amounts;

    public double? this[int nutrientId] => _amounts.TryGetValue(nutrientId, out var v) ? v : null;

    public double Get(int nutrientId) => _amounts.GetValueOrDefault(nutrientId);

    public bool Has(int nutrientId) => _amounts.ContainsKey(nutrientId);

    public double Calories => Get(NutrientIds.Energy);
    public double Protein => Get(NutrientIds.Protein);
    public double Carbs => Get(NutrientIds.Carbohydrate);
    public double Fat => Get(NutrientIds.Fat);
    public double Fiber => Get(NutrientIds.Fiber);

    public NutrientProfile Scale(double factor)
    {
        if (factor < 0) throw new ArgumentOutOfRangeException(nameof(factor), "Factor cannot be negative.");
        return new NutrientProfile(_amounts.ToDictionary(kv => kv.Key, kv => kv.Value * factor));
    }

    /// <summary>Nutrients for <paramref name="grams"/> of a food whose profile is per 100 g.</summary>
    public NutrientProfile ForGrams(double grams) => Scale(grams / 100.0);

    public NutrientProfile Add(NutrientProfile other)
    {
        var result = new Dictionary<int, double>(_amounts);
        foreach (var (id, amount) in other._amounts)
            result[id] = result.GetValueOrDefault(id) + amount;
        return new NutrientProfile(result);
    }

    public NutrientProfile Subtract(NutrientProfile other)
    {
        var result = new Dictionary<int, double>(_amounts);
        foreach (var (id, amount) in other._amounts)
            result[id] = result.GetValueOrDefault(id) - amount;
        return new NutrientProfile(result);
    }

    public static NutrientProfile operator +(NutrientProfile a, NutrientProfile b) => a.Add(b);
    public static NutrientProfile operator -(NutrientProfile a, NutrientProfile b) => a.Subtract(b);
    public static NutrientProfile operator *(NutrientProfile a, double factor) => a.Scale(factor);

    public static NutrientProfile Sum(IEnumerable<NutrientProfile> profiles) =>
        profiles.Aggregate(Empty, (acc, p) => acc.Add(p));

    /// <summary>Rounds for display / storage snapshots. Keeps 3 decimals which is plenty for µg.</summary>
    public NutrientProfile Rounded(int decimals = 3) =>
        new(_amounts.ToDictionary(kv => kv.Key, kv => Math.Round(kv.Value, decimals)));

    public bool Equals(NutrientProfile? other) =>
        other is not null &&
        other._amounts.Count == _amounts.Count &&
        _amounts.All(kv => other._amounts.TryGetValue(kv.Key, out var v) && Math.Abs(v - kv.Value) < 1e-9);

    public override bool Equals(object? obj) => Equals(obj as NutrientProfile);

    public override int GetHashCode() => _amounts.Count;

    public override string ToString() =>
        $"{Calories:0} kcal, P {Protein:0.#} g, C {Carbs:0.#} g, F {Fat:0.#} g";
}
