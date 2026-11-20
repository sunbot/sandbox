using System.Text.Json;
using Anthropic.Models.Beta.Messages;
using Microsoft.Extensions.Options;
using NutriPlan.Application.Abstractions;

namespace NutriPlan.Infrastructure.Ai;

/// <summary>
/// Drafts recipe ideas as plain ingredient lines + steps. Ingredient lines are written with weights/standard
/// measures so the app's matcher can convert them to grams; nutrition is computed from USDA data, not the model.
/// </summary>
public sealed class ClaudeRecipeIdeaGenerator(ClaudeJsonClient claude, IOptions<ClaudeOptions> options) : IRecipeIdeaGenerator
{
    public bool IsAvailable => claude.IsConfigured;

    private const string System = """
        You are a recipe developer for a nutrition-tracking app. Suggest real, cookable home recipes that fit the request.
        The app calculates nutrition itself from a food database, so:
        - Do NOT include calories or nutrition numbers anywhere.
        - Write every ingredient line as "<amount> <unit> <ingredient>[, preparation]", using grams or standard US
          measures (cup, tbsp, tsp, oz, lb) or counts for whole items ("2 large eggs"). One ingredient per line.
          Name ingredients the way a grocery database would ("chicken breast, boneless skinless", "rolled oats").
        - Give the number of servings the recipe makes.
        - Directions: short numbered steps in one string separated by newlines.
        - description: one appealing sentence.
        Respect any dietary constraints given. Vary the ideas.
        """;

    private static readonly IReadOnlyDictionary<string, JsonElement> Schema = JsonSchema.Parse("""
        {
          "type": "object",
          "additionalProperties": false,
          "required": ["recipes"],
          "properties": {
            "recipes": {
              "type": "array",
              "items": {
                "type": "object",
                "additionalProperties": false,
                "required": ["name", "description", "servings", "ingredients", "directions"],
                "properties": {
                  "name": { "type": "string" },
                  "description": { "type": "string" },
                  "servings": { "type": "number" },
                  "ingredients": { "type": "array", "items": { "type": "string" } },
                  "directions": { "type": "string" }
                }
              }
            }
          }
        }
        """);

    public async Task<IReadOnlyList<RecipeIdea>> GenerateAsync(string request, int count, string? constraints, CancellationToken ct = default)
    {
        var user = $"Request: {request}\nNumber of recipes: {count}" + (constraints is null ? "" : $"\nConstraints: {constraints}");
        using var doc = await claude.CompleteJsonAsync(options.Value.RecipeModel, System, user, Schema, Effort.Medium, 16000, ct);

        var result = new List<RecipeIdea>();
        foreach (var r in doc.RootElement.GetProperty("recipes").EnumerateArray())
        {
            result.Add(new RecipeIdea(
                r.GetProperty("name").GetString() ?? "Recipe",
                r.GetProperty("description").GetString() ?? "",
                r.GetProperty("servings").GetDouble(),
                r.GetProperty("ingredients").EnumerateArray().Select(i => i.GetString() ?? "").Where(s => s.Length > 0).ToList(),
                r.GetProperty("directions").GetString() ?? ""));
        }
        return result.Take(count).ToList();
    }
}
