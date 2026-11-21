using NutriPlan.Domain.Diary;
using NutriPlan.Domain.Foods;
using NutriPlan.Domain.Nutrients;

namespace NutriPlan.Application.Abstractions;

/// <summary>Looks up packaged foods by barcode in an outside database (Open Food Facts, a paid API...).</summary>
public interface IBarcodeProvider
{
    string Name { get; }
    /// <summary>
    /// Found (a new, unsaved <see cref="Food"/>), NotFound (the provider answered and doesn't know the code), or Failed
    /// (couldn't get an answer: network, timeout, rate limit, unreadable response). A failure is never reported as not found.
    /// </summary>
    Task<BarcodeLookup> LookupAsync(string normalizedBarcode, CancellationToken ct = default);
}

public enum BarcodeLookupStatus { Found, NotFound, Failed }

/// <summary>Why a provider couldn't answer. Temporary: the user should retry, not type the label in.</summary>
public enum ProviderFailure { Network, Timeout, RateLimited, BadResponse }

public sealed record BarcodeLookup(BarcodeLookupStatus Status, Food? Food = null, ProviderFailure? Failure = null)
{
    public static BarcodeLookup Found(Food food) => new(BarcodeLookupStatus.Found, food);
    public static readonly BarcodeLookup NotFound = new(BarcodeLookupStatus.NotFound);
    public static BarcodeLookup Failed(ProviderFailure why) => new(BarcodeLookupStatus.Failed, null, why);
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

/// <summary>
/// A packaged product from an external text-searchable database (USDA FoodData Central Branded), already normalized:
/// nutrients per 100 g or per 100 ml (<see cref="Basis"/>), only values the label reported (missing stays missing),
/// the labelled serving as a portion when its size is known. Nothing here is estimated.
/// </summary>
public sealed record BrandedProduct(
    FoodSource Source,
    string SourceId,
    string Name,
    string? Brand,
    string? Barcode,
    NutrientProfile Per100,
    NutrientBasis Basis,
    IReadOnlyList<FoodPortion> Portions,
    DateOnly? LabelDate);

public sealed record BrandedSearch(IReadOnlyList<BrandedProduct> Products, ProviderFailure? Failure = null);

public sealed record BrandedFetch(BrandedProduct? Product, ProviderFailure? Failure = null);

/// <summary>
/// Text search over branded/packaged foods. Separate from <see cref="IBarcodeProvider"/> (barcode-only). Implementations
/// live in Infrastructure; failures are reported, never thrown, so local search keeps working.
/// </summary>
public interface IBrandedFoodProvider
{
    string Name { get; }
    /// <summary>False when no API key is configured: searches return nothing instead of calling the service.</summary>
    bool IsConfigured { get; }
    Task<BrandedSearch> SearchAsync(string query, int limit, CancellationToken ct = default);
    Task<BrandedFetch> GetAsync(string sourceId, CancellationToken ct = default);
    Task<BrandedFetch> FindByBarcodeAsync(string normalizedBarcode, CancellationToken ct = default);
}
