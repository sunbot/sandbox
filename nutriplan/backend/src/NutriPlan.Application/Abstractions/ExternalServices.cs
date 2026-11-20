using NutriPlan.Domain.Diary;
using NutriPlan.Domain.Foods;

namespace NutriPlan.Application.Abstractions;

/// <summary>Looks up packaged foods by barcode in an outside database (Open Food Facts, a paid API...).</summary>
public interface IBarcodeProvider
{
    string Name { get; }
    /// <summary>Returns a new, unsaved <see cref="Food"/> or null if the barcode is unknown.</summary>
    Task<Food?> LookupAsync(string normalizedBarcode, CancellationToken ct = default);
}

public interface IWebPageFetcher
{
    Task<string> GetHtmlAsync(Uri url, CancellationToken ct = default);
}

public enum AssistantIntent
{
    /// <summary>"I had two eggs and toast" — log food.</summary>
    LogFood,
    /// <summary>"half a pound of chicken breast" — just look it up.</summary>
    FindFood,
    /// <summary>"Christmas recipes", "high protein dinners" — recipe ideas.</summary>
    FindRecipes,
    /// <summary>"What can I make with what I have?"</summary>
    WhatCanIMake,
    /// <summary>"What should I eat to hit my protein?"</summary>
    FillGaps,
    /// <summary>"Plan pizza for Friday dinner."</summary>
    PlanMeal,
    Unknown,
}

/// <summary>One food mentioned in free text, already split into parts. Never contains nutrition numbers.</summary>
public sealed record InterpretedItem(
    string FoodQuery,
    double? Amount,
    string? Unit,
    string? Preparation,
    string? Brand,
    /// <summary>"raw" or "cooked" when it matters for accuracy (meat, grains, pasta…), else null.</summary>
    string? CookedState);

public sealed record InterpretedRequest(
    AssistantIntent Intent,
    IReadOnlyList<InterpretedItem> Items,
    MealSlot? Meal,
    DateOnly? Date,
    string? RecipeQuery,
    int? RecipeCount,
    string? Reply);

/// <summary>
/// Language understanding (Claude). It only structures text — food numbers always come from the database.
/// When no API key is configured the rule-based fallback is used instead.
/// </summary>
public interface ILanguageInterpreter
{
    bool IsAvailable { get; }
    Task<InterpretedRequest> InterpretAsync(string text, DateOnly today, CancellationToken ct = default);
}

public sealed record RecipeIdea(string Name, string Description, double Servings, IReadOnlyList<string> Ingredients, string Directions);

/// <summary>Drafts recipe ideas (ingredients + steps). Their nutrition is computed by matching ingredients, not trusted from the model.</summary>
public interface IRecipeIdeaGenerator
{
    bool IsAvailable { get; }
    Task<IReadOnlyList<RecipeIdea>> GenerateAsync(string request, int count, string? constraints, CancellationToken ct = default);
}
