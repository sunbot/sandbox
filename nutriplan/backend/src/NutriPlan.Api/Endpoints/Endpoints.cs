using Microsoft.AspNetCore.Mvc;
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
public sealed record ScaleRequest(double Scale);
public sealed record SwapRecipeRequest(Guid RecipeId, double Servings = 1);
public sealed record SwapFoodRequest(Guid FoodId, double? Grams, double? Amount, string? Unit);
public sealed record RebalanceApplyRequest(DateOnly Date, double Scale);
public sealed record RelogRequest(DateOnly Date, MealSlot? Meal);
public sealed record CopyRequest(DateOnly From, DateOnly To, MealSlot? Meal, MealSlot? ToMeal);
public sealed record UpdateDiaryRequest(double? Scale, DateOnly? Date, MealSlot? Meal, string? Note);
public sealed record FavoriteRequest(bool Favorite);
public sealed record ServingsRequest(double Servings);
public sealed record UrlImportRequest(string Url);
public sealed record EatenRequest(double Scale = 1);

public static class FoodEndpoints
{
    public static void MapFoodEndpoints(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/foods").WithTags("Foods");
        g.MapGet("/search", (string q, int? limit, FoodService s, CancellationToken ct) => s.SearchAsync(q, Math.Clamp(limit ?? 25, 1, 100), ct));
        g.MapGet("/match", (string text, FoodService s, CancellationToken ct) => s.MatchTextAsync(text, 8, ct));
        g.MapGet("/barcode/{code}", async (string code, FoodService s, CancellationToken ct) =>
            await s.LookupBarcodeAsync(code, ct) is { } food ? Results.Ok(food) : Results.NotFound(new { title = "Barcode not found. Add it as a custom food." }));
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
        g.MapPost("/foods", (LogFoodsRequest r, DiaryService s, CancellationToken ct) => s.LogFoodsAsync(r, ct));
        g.MapPost("/recipe", (LogRecipeRequest r, DiaryService s, CancellationToken ct) => s.LogRecipeAsync(r, ct));
        g.MapPost("/quick", (LogQuickRequest r, DiaryService s, CancellationToken ct) => s.LogQuickAsync(r, ct));
        g.MapPost("/copy", (CopyRequest r, DiaryService s, CancellationToken ct) => s.CopyAsync(r.From, r.To, r.Meal, r.ToMeal, ct));
        g.MapPost("/{id:guid}/relog", (Guid id, RelogRequest r, DiaryService s, CancellationToken ct) => s.RelogAsync(id, r.Date, r.Meal, ct));
        g.MapPatch("/{id:guid}", (Guid id, UpdateDiaryRequest r, DiaryService s, CancellationToken ct) => s.UpdateAsync(id, r.Scale, r.Date, r.Meal, r.Note, ct));
        g.MapDelete("/{id:guid}", async (Guid id, DiaryService s, CancellationToken ct) => { await s.DeleteAsync(id, ct); return Results.NoContent(); });
    }
}

public static class PlanEndpoints
{
    public static void MapPlanEndpoints(this RouteGroupBuilder api)
    {
        var g = api.MapGroup("/plan").WithTags("Plan");
        g.MapGet("/week", (DateOnly date, PlanService s, CancellationToken ct) => s.GetWeekAsync(date, ct));
        g.MapPost("/food", (AddPlanFoodRequest r, PlanService s, CancellationToken ct) => s.AddFoodAsync(r, ct));
        g.MapPost("/foods", (AddPlanFoodsRequest r, PlanService s, CancellationToken ct) => s.AddFoodsAsync(r, ct));
        g.MapPost("/recipe", (AddPlanRecipeRequest r, PlanService s, CancellationToken ct) => s.AddRecipeAsync(r, ct));
        g.MapPost("/batch", (AddBatchRequest r, PlanService s, CancellationToken ct) => s.AddBatchAsync(r, ct));
        g.MapPost("/{id:guid}/move", (Guid id, MoveRequest r, PlanService s, CancellationToken ct) => s.MoveAsync(id, r.Date, r.Meal, ct));
        g.MapPost("/{id:guid}/swap-recipe", (Guid id, SwapRecipeRequest r, PlanService s, CancellationToken ct) => s.SwapForRecipeAsync(id, r.RecipeId, r.Servings, ct));
        g.MapPost("/{id:guid}/swap-food", (Guid id, SwapFoodRequest r, PlanService s, CancellationToken ct) => s.SwapForFoodAsync(id, r.FoodId, r.Grams, r.Amount, r.Unit, ct));
        g.MapPost("/{id:guid}/rescale", (Guid id, ScaleRequest r, PlanService s, CancellationToken ct) => s.RescaleAsync(id, r.Scale, ct));
        g.MapPost("/{id:guid}/eaten", (Guid id, EatenRequest? r, PlanService s, CancellationToken ct) => s.MarkEatenAsync(id, r?.Scale ?? 1, ct));
        g.MapPost("/{id:guid}/skip", (Guid id, PlanService s, CancellationToken ct) => s.MarkSkippedAsync(id, ct));
        g.MapDelete("/{id:guid}", async (Guid id, PlanService s, CancellationToken ct) => { await s.DeleteAsync(id, ct); return Results.NoContent(); });
        g.MapGet("/rebalance", (DateOnly date, PlanService s, CancellationToken ct) => s.ProposeRebalanceAsync(date, ct));
        g.MapPost("/rebalance", (RebalanceApplyRequest r, PlanService s, CancellationToken ct) => s.ApplyRebalanceAsync(r.Date, r.Scale, ct));
        g.MapGet("/gaps", (DateOnly date, bool? includePlanned, bool? micros, bool? recipesOnly, int? maxItems, GapFillService s, CancellationToken ct) =>
            s.SuggestAsync(new GapFillRequest(date, includePlanned ?? true, micros ?? true, maxItems ?? 3, recipesOnly ?? false), ct));
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
        g.MapPost("/{id:guid}/rematch", (Guid id, RecipeService s, CancellationToken ct) => s.RematchAsync(id, ct));
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
        api.MapGet("/insights/heatmap", (DateOnly? date, InsightsService s, CancellationToken ct) => s.GetHeatmapAsync(date, ct)).WithTags("Insights");
    }
}

public static class AssistantEndpoints
{
    public static void MapAssistantEndpoints(this RouteGroupBuilder api)
    {
        api.MapPost("/assistant", (AssistantRequest r, AssistantService s, CancellationToken ct) => s.HandleAsync(r, ct)).WithTags("Assistant");
        api.MapGet("/status", (NutriPlan.Application.Abstractions.ILanguageInterpreter ai, NutriPlan.Infrastructure.Persistence.NutriPlanDbContext db) =>
            new { languageModel = ai.IsAvailable, foods = db.Foods.Count() }).WithTags("Assistant");
    }
}
