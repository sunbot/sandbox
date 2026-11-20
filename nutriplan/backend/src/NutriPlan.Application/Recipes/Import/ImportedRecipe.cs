namespace NutriPlan.Application.Recipes.Import;

/// <summary>Source-neutral recipe data produced by every importer (Paprika, web pages, the assistant).</summary>
public sealed record ImportedRecipe
{
    public required string Name { get; init; }
    public IReadOnlyList<string> IngredientLines { get; init; } = [];
    public string? Directions { get; init; }
    public string? Description { get; init; }
    public string? Notes { get; init; }
    public double? Servings { get; init; }
    public string? ServingsText { get; init; }
    public string? PrepTime { get; init; }
    public string? CookTime { get; init; }
    public string? TotalTime { get; init; }
    public string? SourceName { get; init; }
    public string? SourceUrl { get; init; }
    public string? ImageUrl { get; init; }
    public byte[]? Photo { get; init; }
    public IReadOnlyList<string> Categories { get; init; } = [];
    public int? Rating { get; init; }
    public string? ExternalId { get; init; }
    public string? SourceNutritionText { get; init; }
}
