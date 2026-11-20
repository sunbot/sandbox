using NutriPlan.Application.Abstractions;
using NutriPlan.Application.Foods;
using NutriPlan.Application.Pantry;
using NutriPlan.Application.Planning;
using NutriPlan.Application.Recipes;
using NutriPlan.Domain.Recipes;
using Microsoft.Extensions.Logging;

namespace NutriPlan.Application.Assistant;

public sealed record AssistantRequest(string Text, DateOnly? Date);

public sealed record RecipeIdeaDto(
    string Name, string Description, double Servings, IReadOnlyList<string> Ingredients, string Directions,
    Common.NutritionDto PerServing, double Coverage, IReadOnlyList<string> Warnings);

public sealed record AssistantResponse(
    string Intent,
    string Reply,
    bool UsedLanguageModel,
    string? Meal,
    DateOnly Date,
    IReadOnlyList<FoodMatchGroupDto> FoodMatches,
    IReadOnlyList<RecipeSummaryDto> SavedRecipes,
    IReadOnlyList<RecipeIdeaDto> RecipeIdeas,
    IReadOnlyList<CookableRecipeDto> Cookable,
    GapReportDto? Gaps);

/// <summary>
/// The chat / voice entry point. Understands the request (Claude if configured, otherwise rules),
/// then hands off to the regular services. It always returns *choices* — nothing is logged until you tap.
/// </summary>
public sealed class AssistantService(
    ILanguageInterpreter interpreter,
    IRecipeIdeaGenerator ideaGenerator,
    FoodService foodService,
    RecipeService recipeService,
    PantryService pantryService,
    GapFillService gapFillService,
    IClock clock,
    ILogger<AssistantService> logger)
{
    public async Task<AssistantResponse> HandleAsync(AssistantRequest request, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(request.Text)) throw new Common.ValidationException("Say or type something to search for.");
        var today = request.Date ?? clock.Today;

        InterpretedRequest interpreted;
        var usedModel = false;
        if (interpreter.IsAvailable)
        {
            try
            {
                interpreted = await interpreter.InterpretAsync(request.Text, today, ct);
                usedModel = true;
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogWarning(ex, "Language model unavailable, falling back to rules.");
                interpreted = RuleBasedInterpreter.Interpret(request.Text, today);
            }
        }
        else interpreted = RuleBasedInterpreter.Interpret(request.Text, today);

        var date = interpreted.Date ?? today;
        var meal = interpreted.Meal?.ToString();

        switch (interpreted.Intent)
        {
            case AssistantIntent.WhatCanIMake:
            {
                var cookable = await pantryService.WhatCanIMakeAsync(ct: ct);
                var reply = cookable.Count == 0
                    ? "I couldn't find a saved recipe you can make from your pantry. Add pantry items or import recipes."
                    : $"You can make {cookable.Count(c => c.Missing.Count == 0)} recipes now; {cookable.Count(c => c.Missing.Count > 0)} more need a few items.";
                return Response(interpreted, reply, usedModel, meal, date, cookable: cookable);
            }

            case AssistantIntent.FillGaps:
            {
                var gaps = await gapFillService.SuggestAsync(new GapFillRequest(date), ct);
                var reply = gaps.Suggestions.Count == 0
                    ? "You're on target for the day — nothing to fill."
                    : $"Here are {gaps.Suggestions.Count} ways to round out {(date == clock.Today ? "today" : date.ToString("ddd MMM d"))}.";
                return Response(interpreted, reply, usedModel, meal, date, gaps: gaps);
            }

            case AssistantIntent.FindRecipes:
            {
                var query = interpreted.RecipeQuery ?? request.Text;
                var saved = (await recipeService.ListAsync(query, null, ct)).Take(10).ToList();
                if (saved.Count == 0)
                {
                    // Try each word against your library ("christmas cookies" → recipes tagged Christmas).
                    var words = query.Split(' ', StringSplitOptions.RemoveEmptyEntries).Where(w => w.Length > 3);
                    foreach (var w in words)
                        saved.AddRange((await recipeService.ListAsync(w, null, ct)).Where(r => saved.All(s => s.Id != r.Id)));
                    saved = saved.Take(10).ToList();
                }

                var ideas = new List<RecipeIdeaDto>();
                if (ideaGenerator.IsAvailable)
                {
                    var generated = await ideaGenerator.GenerateAsync(query, Math.Clamp(interpreted.RecipeCount ?? 4, 1, 8), null, ct);
                    foreach (var idea in generated) ideas.Add(await PriceIdeaAsync(idea, ct));
                }

                var reply = (saved.Count, ideas.Count) switch
                {
                    (0, 0) when !ideaGenerator.IsAvailable => "No saved recipes match. Add a Claude API key to get new recipe ideas, or import from Paprika / a link.",
                    (0, 0) => "I couldn't find recipes for that.",
                    _ => $"{(saved.Count > 0 ? $"{saved.Count} from your recipes" : "")}{(saved.Count > 0 && ideas.Count > 0 ? " and " : "")}{(ideas.Count > 0 ? $"{ideas.Count} new ideas (nutrition calculated from USDA data)" : "")}.",
                };
                return Response(interpreted, reply, usedModel, meal, date, saved: saved, ideas: ideas);
            }

            default:
            {
                var groups = new List<FoodMatchGroupDto>();
                foreach (var item in interpreted.Items.Take(12))
                {
                    var label = $"{item.Amount?.ToString("0.##")} {item.Unit} {item.FoodQuery}".Trim();
                    var query = item.Brand is null ? item.FoodQuery : $"{item.Brand} {item.FoodQuery}";
                    groups.Add(await foodService.MatchAsync(label, query, item.Amount, item.Unit, item.CookedState, 6, ct));
                }
                var reply = interpreted.Reply ?? (groups.Count switch
                {
                    0 => "I didn't catch a food. Try something like \"2 eggs and toast\".",
                    1 => groups[0].Matches.Count == 0 ? $"No match for \"{groups[0].FoodQuery}\"." : "Pick the best match:",
                    _ => $"Found {groups.Count} items — check each match, then add them.",
                });
                return Response(interpreted, reply, usedModel, meal, date, foods: groups);
            }
        }
    }

    /// <summary>Calculates an idea's nutrition from USDA data via the normal ingredient matcher (not saved).</summary>
    private async Task<RecipeIdeaDto> PriceIdeaAsync(RecipeIdea idea, CancellationToken ct)
    {
        var recipe = new Recipe(idea.Name, idea.Servings > 0 ? idea.Servings : 1, RecipeOrigin.Assistant);
        recipe.SetIngredientLines(idea.Ingredients);
        await recipeService.MatchIngredientsAsync(recipe, onlyUnmatched: false, ct);
        var warnings = recipe.Ingredients.Where(i => i.Status == IngredientMatchStatus.Unmatched || (i.FoodId is not null && i.Grams is null))
            .Select(i => $"Not counted: {i.RawText}").ToList();
        return new RecipeIdeaDto(idea.Name, idea.Description, recipe.Servings, idea.Ingredients, idea.Directions,
            Common.NutritionDto.From(recipe.NutritionPerServing), Math.Round(recipe.NutritionCoverage, 2), warnings);
    }

    private static AssistantResponse Response(
        InterpretedRequest i, string reply, bool usedModel, string? meal, DateOnly date,
        IReadOnlyList<FoodMatchGroupDto>? foods = null, IReadOnlyList<RecipeSummaryDto>? saved = null,
        IReadOnlyList<RecipeIdeaDto>? ideas = null, IReadOnlyList<CookableRecipeDto>? cookable = null, GapReportDto? gaps = null) =>
        new(i.Intent.ToString(), reply, usedModel, meal, date, foods ?? [], saved ?? [], ideas ?? [], cookable ?? [], gaps);
}
