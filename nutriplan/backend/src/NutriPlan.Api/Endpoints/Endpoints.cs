using Microsoft.AspNetCore.Mvc;
using NutriPlan.Application.Common;
using NutriPlan.Application.Abstractions;
using NutriPlan.Application.Assistant;
using NutriPlan.Application.Diary;
using NutriPlan.Application.Foods;
using NutriPlan.Application.Insights;
using NutriPlan.Application.Pantry;
using NutriPlan.Application.Planning;
using NutriPlan.Application.Recipes;
using NutriPlan.Domain.Diary;
using NutriPlan.Domain.Nutrients;

namespace NutriPlan.Api.Endpoints;

// Thin HTTP layer: parse the request, call one application service, return its DTO.
// Business rules live in NutriPlan.Application / NutriPlan.Domain.

public sealed record MoveRequest(DateOnly Date, MealSlot Meal);
public sealed record PlanCopyRequest(DateOnly From, DateOnly To, MealSlot? Meal);
public sealed record ScaleRequest(double Scale);
public sealed record SwapRecipeRequest(Guid RecipeId, double Servings = 1);
public sealed record SwapFoodRequest(Guid FoodId, double? Grams, double? Amount, string? Unit);
public sealed record RebalanceApplyRequest(DateOnly Date, double Scale);
public sealed record RelogRequest(DateOnly Date, MealSlot? Meal);
public sealed record CopyRequest(DateOnly From, DateOnly To, MealSlot? Meal, MealSlot? ToMeal);
public sealed record UpdateDiaryRequest(double? Scale, DateOnly? Date, MealSlot? Meal, string? Note, double? Amount = null, string? Unit = null, double? Grams = null);
public sealed record AmountRequest(double Amount, string? Unit, double? Grams = null);
public sealed record FavoriteRequest(bool Favorite);
public sealed record ServingsRequest(double Servings);
public sealed record UrlImportRequest(string Url);
public sealed record EatenRequest(double Scale = 1, DateOnly? Today = null);

public static class FoodEndpoints
{
    public static void MapFoodEndpoints(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/foods").WithTags("Foods");
        g.MapGet("/search", (string q, int? limit, FoodService s, CancellationToken ct) => s.SearchAsync(q, Math.Clamp(limit ?? 25, 1, 100), ct));
        g.MapGet("/match", (string text, FoodService s, CancellationToken ct) => s.MatchTextAsync(text, 8, ct));
        // Branded/packaged products from USDA FoodData Central: search (nothing saved), then add one to log it.
        g.MapGet("/branded", (string q, int? limit, BrandedFoodService s, CancellationToken ct) => s.SearchAsync(q, limit ?? 20, ct)).RequireRateLimiting("external-food");
        g.MapPost("/branded/{sourceId}", (string sourceId, BrandedFoodService s, CancellationToken ct) => s.AddAsync(sourceId, ct)).RequireRateLimiting("external-food");
        g.MapGet("/barcode/{code}", async (string code, FoodService s, CancellationToken ct) => await s.LookupBarcodeAsync(code, ct) switch
        {
            { Food: { } food } => Results.Ok(food),
            { Failure: null } => Results.NotFound(new { title = "This barcode isn't in any food database yet.", reason = "NotFound" }),
            { Failure: var why } => Results.Json(new
            {
                title = why switch
                {
                    ProviderFailure.Timeout => "The product database took too long to answer.",
                    ProviderFailure.RateLimited => "The product database is busy right now.",
                    ProviderFailure.BadResponse => "The product database sent an answer the app couldn't read.",
                    _ => "Couldn't reach the product database.",
                },
                reason = why.ToString(),
            }, statusCode: StatusCodes.Status503ServiceUnavailable),
        });
        g.MapGet("/{id:guid}", (Guid id, FoodService s, CancellationToken ct) => s.GetAsync(id, ct));
        g.MapGet("/{id:guid}/quantity", (Guid id, double amount, string? unit, FoodService s, CancellationToken ct) => s.ResolveQuantityAsync(id, amount, unit, ct));
        g.MapPost("/", (CreateFoodRequest r, FoodService s, CancellationToken ct) => s.CreateCustomAsync(r, ct));
        g.MapPost("/{id:guid}/verify", (Guid id, FoodService s, CancellationToken ct) => s.VerifyAsync(id, ct));
        api.MapGet("/nutrients", () => NutrientCatalog.All).WithTags("Foods");
    }
}

public static class DiaryEndpoints
{
    public static void MapDiaryEndpoints(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/diary").WithTags("Diary");
        g.MapGet("/{date}", (DateOnly date, DiaryService s, CancellationToken ct) => s.GetDayAsync(date, ct));
        g.MapGet("/quick-log", (MealSlot? meal, int? limit, DiaryService s, CancellationToken ct) => s.GetQuickLogAsync(meal, Math.Clamp(limit ?? 20, 1, 50), ct));
        g.MapPost("/food", (LogFoodRequest r, DiaryService s, CancellationToken ct) => s.LogFoodAsync(r, ct));
        g.MapPost("/foods", ([Microsoft.AspNetCore.Mvc.FromHeader(Name = "Idempotency-Key")] string? key, LogFoodsRequest r, DiaryService s, IdempotencyStore once, NutriPlan.Application.Abstractions.ICurrentUser me, CancellationToken ct) =>
            once.RunAsync(me.Id, key, r, () => s.LogFoodsAsync(r, ct)));
        g.MapPost("/recipe", (LogRecipeRequest r, DiaryService s, CancellationToken ct) => s.LogRecipeAsync(r, ct));
        g.MapPost("/quick", (LogQuickRequest r, DiaryService s, CancellationToken ct) => s.LogQuickAsync(r, ct));
        g.MapPost("/copy", (CopyRequest r, DiaryService s, CancellationToken ct) => s.CopyAsync(r.From, r.To, r.Meal, r.ToMeal, ct));
        g.MapPost("/move", (MoveDiaryEntriesRequest r, DiaryService s, CancellationToken ct) => s.MoveManyAsync(r, ct));
        g.MapPost("/{id:guid}/relog", (Guid id, RelogRequest r, DiaryService s, CancellationToken ct) => s.RelogAsync(id, r.Date, r.Meal, ct));
        g.MapPatch("/{id:guid}", (Guid id, UpdateDiaryRequest r, DiaryService s, CancellationToken ct) => s.UpdateAsync(id, r.Scale, r.Date, r.Meal, r.Note, ct, r.Amount, r.Unit, r.Grams));
        g.MapDelete("/{id:guid}", async (Guid id, DiaryService s, CancellationToken ct) => { await s.DeleteAsync(id, ct); return Results.NoContent(); });
    }
}

public static class PlanEndpoints
{
    public static void MapPlanEndpoints(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/plan").WithTags("Plan");
        g.MapGet("/week", (DateOnly date, DateOnly? today, PlanService s, CancellationToken ct) => s.GetWeekAsync(date, today, ct));
        g.MapPost("/food", (AddPlanFoodRequest r, PlanService s, CancellationToken ct) => s.AddFoodAsync(r, ct));
        g.MapPost("/foods", ([Microsoft.AspNetCore.Mvc.FromHeader(Name = "Idempotency-Key")] string? key, AddPlanFoodsRequest r, PlanService s, IdempotencyStore once, NutriPlan.Application.Abstractions.ICurrentUser me, CancellationToken ct) =>
            once.RunAsync(me.Id, key, r, () => s.AddFoodsAsync(r, ct)));
        g.MapPost("/recipe", (AddPlanRecipeRequest r, PlanService s, CancellationToken ct) => s.AddRecipeAsync(r, ct));
        g.MapPost("/batch", (AddBatchRequest r, PlanService s, CancellationToken ct) => s.AddBatchAsync(r, ct));
        g.MapPost("/{id:guid}/move", (Guid id, MoveRequest r, PlanService s, CancellationToken ct) => s.MoveAsync(id, r.Date, r.Meal, ct));
        g.MapPost("/{id:guid}/swap-recipe", (Guid id, SwapRecipeRequest r, PlanService s, CancellationToken ct) => s.SwapForRecipeAsync(id, r.RecipeId, r.Servings, ct));
        g.MapPost("/{id:guid}/swap-food", (Guid id, SwapFoodRequest r, PlanService s, CancellationToken ct) => s.SwapForFoodAsync(id, r.FoodId, r.Grams, r.Amount, r.Unit, ct));
        g.MapPost("/{id:guid}/amount", (Guid id, AmountRequest r, PlanService s, CancellationToken ct) => s.SetAmountAsync(id, r.Amount, r.Unit, ct, r.Grams));
        g.MapPost("/{id:guid}/rescale", (Guid id, ScaleRequest r, PlanService s, CancellationToken ct) => s.RescaleAsync(id, r.Scale, ct));
        g.MapPost("/{id:guid}/eaten", (Guid id, EatenRequest? r, PlanService s, CancellationToken ct) => s.MarkEatenAsync(id, r?.Scale ?? 1, r?.Today, ct));
        g.MapPost("/{id:guid}/skip", (Guid id, PlanService s, CancellationToken ct) => s.MarkSkippedAsync(id, ct));
        g.MapPost("/{id:guid}/reopen", (Guid id, PlanService s, CancellationToken ct) => s.ReopenAsync(id, ct));
        g.MapPost("/copy", (PlanCopyRequest r, PlanService s, CancellationToken ct) => s.CopyAsync(r.From, r.To, r.Meal, ct));
        g.MapDelete("/{id:guid}", async (Guid id, PlanService s, CancellationToken ct) => { await s.DeleteAsync(id, ct); return Results.NoContent(); });
        g.MapGet("/rebalance", (DateOnly date, DateOnly? today, PlanService s, CancellationToken ct) => s.ProposeRebalanceAsync(date, today, ct));
        g.MapPost("/rebalance", (RebalanceApplyRequest r, PlanService s, CancellationToken ct) => s.ApplyRebalanceAsync(r.Date, r.Scale, ct));
        // exclude: comma-separated ids of ideas already shown this session ("Show different ideas"); at most 300 are used.
        g.MapGet("/gaps", (DateOnly date, bool? includePlanned, bool? micros, bool? recipesOnly, int? maxItems, NutriPlan.Domain.Planning.GapMode? mode, MealSlot? meal, string? exclude, GapFillService s, CancellationToken ct) =>
            s.SuggestAsync(new GapFillRequest(date, includePlanned ?? true, micros ?? true, maxItems ?? 3, recipesOnly ?? false, mode, meal,
                exclude?.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Take(GapFillRequest.MaxExclude).ToList()), ct));
        g.MapGet("/grocery", (DateOnly from, DateOnly to, bool? subtractPantry, GroceryService s, CancellationToken ct) => s.BuildAsync(from, to, subtractPantry ?? true, ct));

        var t = api.MapGroup("/targets").WithTags("Targets");
        t.MapGet("/", (TargetsService s, CancellationToken ct) => s.GetAsync(ct));
        t.MapPut("/", (UpdateTargetsRequest r, TargetsService s, CancellationToken ct) => s.UpdateAsync(r, ct));
    }
}

public static class RecipeEndpoints
{
    public static void MapRecipeEndpoints(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/recipes").WithTags("Recipes");
        g.MapGet("/", (string? search, string? category, RecipeService s, CancellationToken ct) => s.ListAsync(search, category, ct));
        g.MapGet("/{id:guid}", (Guid id, RecipeService s, CancellationToken ct) => s.GetAsync(id, ct));
        g.MapGet("/{id:guid}/photo", async (Guid id, RecipeService s, CancellationToken ct) =>
            await s.GetPhotoAsync(id, ct) is { Length: > 0 } bytes ? Results.File(bytes, "image/jpeg") : Results.NotFound());
        g.MapPost("/", (SaveRecipeRequest r, RecipeService s, CancellationToken ct) => s.CreateAsync(r, ct));
        g.MapPut("/{id:guid}", (Guid id, SaveRecipeRequest r, RecipeService s, CancellationToken ct) => s.UpdateAsync(id, r, ct));
        g.MapDelete("/{id:guid}", async (Guid id, RecipeService s, CancellationToken ct) => { await s.DeleteAsync(id, ct); return Results.NoContent(); });
        g.MapPost("/{id:guid}/favorite", (Guid id, FavoriteRequest r, RecipeService s, CancellationToken ct) => s.SetFavoriteAsync(id, r.Favorite, ct));
        g.MapPut("/{id:guid}/ingredients/{position:int}", (Guid id, int position, UpdateIngredientRequest r, RecipeService s, CancellationToken ct) =>
            s.UpdateIngredientAsync(id, position, r, ct));
        g.MapPost("/{id:guid}/ingredients", (Guid id, AddIngredientRequest r, RecipeService s, CancellationToken ct) => s.AddIngredientAsync(id, r, ct));
        g.MapDelete("/{id:guid}/ingredients/{position:int}", (Guid id, int position, RecipeService s, CancellationToken ct) => s.RemoveIngredientAsync(id, position, ct));
        g.MapPost("/{id:guid}/rematch", (Guid id, RecipeService s, CancellationToken ct) => s.RematchAsync(id, ct));
        g.MapPost("/{id:guid}/scale", (Guid id, ScaleRecipeRequest r, RecipeService s, CancellationToken ct) => s.ScaleAsync(id, r.Factor, ct));
        g.MapPut("/{id:guid}/servings", (Guid id, ServingsRequest r, RecipeService s, CancellationToken ct) => s.SetServingsAsync(id, r.Servings, ct));
        g.MapPost("/import/paprika", async (IFormFile file, RecipeService s, CancellationToken ct) =>
        {
            await using var stream = file.OpenReadStream();
            return await s.ImportPaprikaAsync(stream, ct);
        }).DisableAntiforgery();
        g.MapPost("/import/url", (UrlImportRequest r, RecipeService s, CancellationToken ct) => s.ImportFromUrlAsync(r.Url, ct));
    }
}

public static class PantryEndpoints
{
    public static void MapPantryEndpoints(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/pantry").WithTags("Pantry");
        g.MapGet("/", (PantryService s, CancellationToken ct) => s.ListAsync(ct));
        g.MapPost("/", (SavePantryItemRequest r, PantryService s, CancellationToken ct) => s.AddAsync(r, ct));
        g.MapPut("/{id:guid}", (Guid id, SavePantryItemRequest r, PantryService s, CancellationToken ct) => s.UpdateAsync(id, r, ct));
        g.MapDelete("/{id:guid}", async (Guid id, PantryService s, CancellationToken ct) => { await s.DeleteAsync(id, ct); return Results.NoContent(); });
        g.MapGet("/what-can-i-make", (int? maxMissing, string? search, PantryService s, CancellationToken ct) => s.WhatCanIMakeAsync(maxMissing ?? 3, search, ct));
    }
}

public static class InsightEndpoints
{
    public static void MapInsightEndpoints(this RouteGroupBuilder api)
    {
        api.MapGet("/insights/heatmap", (DateOnly? date, DateOnly? today, InsightsService s, CancellationToken ct) => s.GetHeatmapAsync(date, today, ct)).WithTags("Insights");
    }
}

public static class AssistantEndpoints
{
    public static void MapAssistantEndpoints(this RouteGroupBuilder api)
    {
        api.MapPost("/assistant", (AssistantRequest r, AssistantService s, CancellationToken ct) => s.HandleAsync(r, ct)).WithTags("Assistant");
        // Which interpreter this server uses for Ask. Reports whether Claude is configured and which model, never the key itself.
        // Each Ask response also says which interpreter handled that request ("Claude", "Rules" or "RulesFallback").
        api.MapGet("/status", (NutriPlan.Application.Abstractions.ILanguageInterpreter ai, Microsoft.Extensions.Options.IOptions<NutriPlan.Infrastructure.Ai.ClaudeOptions> claude,
                NutriPlan.Infrastructure.Persistence.NutriPlanDbContext db) =>
            new
            {
                languageModel = ai.IsAvailable,
                interpreter = ai.IsAvailable ? "Claude" : "Rules",
                interpreterModel = ai.IsAvailable ? claude.Value.InterpreterModel : null,
                foods = db.Foods.Count(),
            }).WithTags("Assistant");
    }
}
