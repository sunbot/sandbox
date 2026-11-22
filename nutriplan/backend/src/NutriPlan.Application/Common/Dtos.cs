using NutriPlan.Domain.Diary;
using NutriPlan.Domain.Foods;
using NutriPlan.Domain.Nutrients;
using NutriPlan.Domain.Units;

namespace NutriPlan.Application.Common;

/// <summary>Nutrition for the client: the headline numbers plus every known nutrient keyed by id.</summary>
public sealed record NutritionDto(
    double Calories,
    double Protein,
    double Carbs,
    double Fat,
    double Fiber,
    IReadOnlyDictionary<int, double> Nutrients)
{
    public static NutritionDto From(NutrientProfile p) => new(
        Math.Round(p.Calories, 1),
        Math.Round(p.Protein, 1),
        Math.Round(p.Carbs, 1),
        Math.Round(p.Fat, 1),
        Math.Round(p.Fiber, 1),
        p.Amounts.ToDictionary(kv => kv.Key, kv => Math.Round(kv.Value, 3)));

    public static readonly NutritionDto Empty = From(NutrientProfile.Empty);
}

public sealed record PortionDto(string Description, double Grams, string? Origin = null);

/// <summary>A measure a food can be logged in: send <c>Unit</c> back with an amount. <c>Base</c> is grams (ml for a drink) in one.</summary>
public sealed record MeasureDto(string Unit, string Label, string Plural, double Base, string Kind, string? Source, bool Countable, string? Origin = null);

public sealed record FoodSummaryDto(
    Guid Id,
    string Name,
    string? Brand,
    string Source,
    string Quality,
    string? QualityNote,
    string? Barcode,
    NutritionDto Per100g,
    IReadOnlyList<PortionDto> Portions,
    string BaseUnit = "g",
    IReadOnlyList<MeasureDto>? Measures = null)
{
    /// <remarks>When <c>BaseUnit</c> is "ml", <c>Per100g</c> is per 100 ml and portion "grams" are millilitres.</remarks>
    public static FoodSummaryDto From(Food f) => new(
        f.Id, f.Name, f.Brand, f.Source.ToString(), f.Quality.ToString(), f.QualityNote, f.Barcode,
        NutritionDto.From(f.NutrientsPer100g),
        f.Portions.Select(p => new PortionDto(p.Description, Math.Round(p.GramsPerUnit, 2), p.Origin)).ToList(),
        f.BaseUnit,
        FoodMeasures.For(f).Select(m => new MeasureDto(m.Unit, m.Label, m.Plural, m.BasePerUnit, m.Kind.ToString(), m.Source, m.Countable, m.Origin)).ToList());
}

public sealed record ItemDto(
    string Kind,
    Guid? FoodId,
    Guid? RecipeId,
    string Name,
    double Quantity,
    string Unit,
    double? Grams,
    NutritionDto Nutrition)
{
    public static ItemDto From(ItemSnapshot s) => new(
        s.Kind.ToString(), s.FoodId, s.RecipeId, s.Name, s.Quantity, s.QuantityUnit, s.Grams, NutritionDto.From(s.Nutrients));
}

/// <param name="Status">
/// <c>Given</c>: the amount you said, converted from USDA data. <c>Assumed</c>: you gave no amount, so a standard USDA portion
/// is shown (e.g. "1 medium") for you to confirm. <c>NeedsAmount</c>: nothing to go on — you must choose an amount
/// (no weight is ever invented).
/// </param>
public sealed record QuantityDto(double? Grams, string Method, string Explanation, string Status = QuantityStatus.Given)
{
    public static QuantityDto From(ResolvedQuantity q, bool amountGiven = true) => new(
        q.Grams is null ? null : Math.Round(q.Grams.Value, 2), q.Method.ToString(), q.Explanation,
        q.Grams is null ? QuantityStatus.NeedsAmount : amountGiven ? QuantityStatus.Given : QuantityStatus.Assumed);
}

public static class QuantityStatus
{
    public const string Given = "Given";
    public const string Assumed = "Assumed";
    public const string NeedsAmount = "NeedsAmount";
}

public sealed class NotFoundException(string message) : Exception(message);

public sealed class ValidationException(string message) : Exception(message);
