using NutriPlan.Application.Abstractions;
using NutriPlan.Application.Common;
using NutriPlan.Application.Foods;
using NutriPlan.Application.Recipes.Import;
using NutriPlan.Domain.Foods;
using NutriPlan.Domain.Recipes;
using NutriPlan.Domain.Units;

namespace NutriPlan.Application.Recipes;

public sealed record IngredientDto(
    int Position, string RawText, double? Amount, string? Unit, string FoodText, string? Preparation,
    Guid? FoodId, string? FoodName, double? Grams, string Status, double MatchConfidence, string? Note, NutritionDto? Nutrition);

public sealed record RecipeSummaryDto(
    Guid Id, string Name, double Servings, string Origin, IReadOnlyList<string> Categories, bool IsFavorite,
    string? ImageUrl, bool HasPhoto, string? TotalTime, NutritionDto PerServing, double Coverage, int? Rating)
{
    public static RecipeSummaryDto From(Recipe r) => new(
        r.Id, r.Name, r.Servings, r.Origin.ToString(), r.Categories, r.IsFavorite, r.ImageUrl, r.Photo is { Length: > 0 },
        r.TotalTime, NutritionDto.From(r.NutritionPerServing), Math.Round(r.NutritionCoverage, 2), r.Rating);
}

public sealed record RecipeDetailDto(
    RecipeSummaryDto Summary, string? Description, string? Directions, string? Notes, string? PrepTime, string? CookTime,
    string? SourceName, string? SourceUrl, string? ServingDescription, double? CookedWeightGrams, string? SourceNutritionText,
    IReadOnlyList<IngredientDto> Ingredients, IReadOnlyList<string> Warnings);

public sealed record ImportResultDto(int Imported, int Updated, IReadOnlyList<RecipeSummaryDto> Recipes, IReadOnlyList<string> Errors);

public sealed record SaveRecipeRequest(
    string Name, double Servings, IReadOnlyList<string> Ingredients, string? Directions, string? Description,
    IReadOnlyList<string>? Categories, string? Notes, double? CookedWeightGrams);

public sealed record UpdateIngredientRequest(Guid? FoodId, double? Grams, double? Amount, string? Unit, bool? Ignore);

public sealed class RecipeService(
    IRecipeRepository recipes,
    IFoodRepository foods,
    FoodService foodService,
    IWebPageFetcher fetcher,
    IUnitOfWork uow)
{
    /// <summary>Below this ranker score an ingredient is left for you to match by hand.</summary>
    public const double MinAutoMatchScore = 45;

    public async Task<IReadOnlyList<RecipeSummaryDto>> ListAsync(string? search, string? category, CancellationToken ct = default) =>
        (await recipes.ListAsync(search, category, ct)).Select(RecipeSummaryDto.From).ToList();

    public async Task<RecipeDetailDto> GetAsync(Guid id, CancellationToken ct = default) =>
        await ToDetailAsync(await Get(id, ct), ct);

    public async Task<byte[]?> GetPhotoAsync(Guid id, CancellationToken ct = default) => (await Get(id, ct)).Photo;

    public async Task<RecipeDetailDto> CreateAsync(SaveRecipeRequest request, CancellationToken ct = default)
    {
        var recipe = new Recipe(request.Name, request.Servings);
        Apply(recipe, request);
        await MatchIngredientsAsync(recipe, onlyUnmatched: false, ct);
        recipes.Add(recipe);
        await uow.SaveChangesAsync(ct);
        return await ToDetailAsync(recipe, ct);
    }

    public async Task<RecipeDetailDto> UpdateAsync(Guid id, SaveRecipeRequest request, CancellationToken ct = default)
    {
        var recipe = await Get(id, ct);
        var oldLines = recipe.Ingredients.Select(i => i.RawText).ToList();
        recipe.Rename(request.Name);
        recipe.SetServings(request.Servings);
        if (!oldLines.SequenceEqual(request.Ingredients.Select(l => l.Trim()).Where(l => l.Length > 0)))
        {
            // Keep confirmed matches for lines that didn't change.
            var previous = recipe.Ingredients.Where(i => i.Status == IngredientMatchStatus.Confirmed).ToDictionary(i => i.RawText, i => i);
            Apply(recipe, request);
            foreach (var ing in recipe.Ingredients)
            {
                if (!previous.TryGetValue(ing.RawText, out var old)) continue;
                (ing.FoodId, ing.FoodName, ing.Grams, ing.Status, ing.MatchConfidence) = (old.FoodId, old.FoodName, old.Grams, old.Status, 1);
            }
            await MatchIngredientsAsync(recipe, onlyUnmatched: true, ct);
        }
        else
        {
            recipe.Directions = request.Directions;
            recipe.Description = request.Description;
            recipe.Notes = request.Notes;
            recipe.CookedWeightGrams = request.CookedWeightGrams;
            if (request.Categories is not null) recipe.SetCategories(request.Categories);
        }
        await RecalculateAsync(recipe, ct);
        await uow.SaveChangesAsync(ct);
        return await ToDetailAsync(recipe, ct);
    }

    public async Task DeleteAsync(Guid id, CancellationToken ct = default)
    {
        recipes.Remove(await Get(id, ct));
        await uow.SaveChangesAsync(ct);
    }

    public async Task<RecipeSummaryDto> SetFavoriteAsync(Guid id, bool favorite, CancellationToken ct = default)
    {
        var recipe = await Get(id, ct);
        recipe.IsFavorite = favorite;
        await uow.SaveChangesAsync(ct);
        return RecipeSummaryDto.From(recipe);
    }

    /// <summary>Point an ingredient at a different food and/or amount, or exclude it.</summary>
    public async Task<RecipeDetailDto> UpdateIngredientAsync(Guid id, int position, UpdateIngredientRequest r, CancellationToken ct = default)
    {
        var recipe = await Get(id, ct);
        var ing = recipe.GetIngredient(position);
        if (r.Ignore == true)
        {
            ing.Status = IngredientMatchStatus.Ignored;
            ing.ResolutionNote = "Excluded by you";
        }
        else
        {
            var foodId = r.FoodId ?? ing.FoodId ?? throw new ValidationException("Choose a food for this ingredient.");
            var food = await foods.GetAsync(foodId, ct) ?? throw new NotFoundException($"Food {foodId} not found.");
            double? grams = r.Grams;
            string? note = null;
            if (grams is null)
            {
                var q = QuantityResolver.Resolve(food, r.Amount ?? ing.Amount ?? 1, r.Amount is not null ? r.Unit : ing.Unit);
                grams = q.Grams;
                note = q.Explanation;
            }
            (ing.FoodId, ing.FoodName, ing.Grams) = (food.Id, food.DisplayName, grams);
            if (r.Amount is not null) (ing.Amount, ing.Unit) = (r.Amount, r.Unit);
            ing.Status = grams is null ? IngredientMatchStatus.AutoMatched : IngredientMatchStatus.Confirmed;
            ing.MatchConfidence = 1;
            ing.ResolutionNote = r.Grams is not null ? $"{r.Grams:0.#} g entered by you" : note;
        }
        await RecalculateAsync(recipe, ct);
        await uow.SaveChangesAsync(ct);
        return await ToDetailAsync(recipe, ct);
    }

    public async Task<RecipeDetailDto> RematchAsync(Guid id, CancellationToken ct = default)
    {
        var recipe = await Get(id, ct);
        await MatchIngredientsAsync(recipe, onlyUnmatched: true, ct);
        await uow.SaveChangesAsync(ct);
        return await ToDetailAsync(recipe, ct);
    }

    public async Task<ImportResultDto> ImportPaprikaAsync(Stream file, CancellationToken ct = default)
    {
        IReadOnlyList<ImportedRecipe> imported;
        try { imported = PaprikaImporter.Read(file); }
        catch (Exception ex) when (ex is InvalidDataException or System.Text.Json.JsonException)
        {
            throw new ValidationException($"That doesn't look like a Paprika export (.paprikarecipes / .paprikarecipe): {ex.Message}");
        }
        return await SaveImportedAsync(imported, RecipeOrigin.Paprika, ct);
    }

    public async Task<RecipeDetailDto> ImportFromUrlAsync(string url, CancellationToken ct = default)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https"))
            throw new ValidationException("Enter a full http(s) link to a recipe page.");
        var html = await fetcher.GetHtmlAsync(uri, ct);
        var imported = JsonLdRecipeExtractor.Extract(html, uri)
            ?? throw new ValidationException("This page doesn't publish structured recipe data (schema.org Recipe), so it can't be imported reliably.");
        var result = await SaveImportedAsync([imported], RecipeOrigin.WebPage, ct);
        return await GetAsync(result.Recipes[0].Id, ct);
    }

    public async Task<ImportResultDto> SaveImportedAsync(IReadOnlyList<ImportedRecipe> imported, RecipeOrigin origin, CancellationToken ct = default)
    {
        int created = 0, updated = 0;
        var errors = new List<string>();
        var saved = new List<Recipe>();

        foreach (var item in imported)
        {
            try
            {
                Recipe? recipe = null;
                var externalId = item.ExternalId ?? (origin == RecipeOrigin.WebPage ? item.SourceUrl : null);
                if (externalId is not null) recipe = await recipes.FindByExternalIdAsync(origin, externalId, ct);

                if (recipe is null)
                {
                    recipe = new Recipe(item.Name, item.Servings ?? 1, origin) { ExternalId = externalId };
                    recipes.Add(recipe);
                    created++;
                }
                else
                {
                    recipe.Rename(item.Name);
                    if (item.Servings is > 0) recipe.SetServings(item.Servings.Value);
                    updated++;
                }

                recipe.ServingDescription = item.ServingsText;
                recipe.Description = item.Description;
                recipe.Directions = item.Directions;
                recipe.Notes = item.Notes;
                recipe.PrepTime = item.PrepTime;
                recipe.CookTime = item.CookTime;
                recipe.TotalTime = item.TotalTime;
                recipe.SourceName = item.SourceName;
                recipe.SourceUrl = item.SourceUrl;
                recipe.ImageUrl = item.ImageUrl;
                recipe.Photo = item.Photo ?? recipe.Photo;
                recipe.Rating = item.Rating;
                recipe.SourceNutritionText = item.SourceNutritionText;
                recipe.SetCategories(item.Categories);
                if (!recipe.Ingredients.Select(i => i.RawText).SequenceEqual(item.IngredientLines.Select(l => l.Trim()).Where(l => l.Length > 0)))
                    recipe.SetIngredientLines(item.IngredientLines);

                await MatchIngredientsAsync(recipe, onlyUnmatched: true, ct);
                saved.Add(recipe);
            }
            catch (Exception ex) when (ex is ArgumentException or ValidationException)
            {
                errors.Add($"{item.Name}: {ex.Message}");
            }
        }

        await uow.SaveChangesAsync(ct);
        return new ImportResultDto(created, updated, saved.Select(RecipeSummaryDto.From).ToList(), errors);
    }

    /// <summary>
    /// Matches each ingredient to the best food and converts its amount to grams.
    /// Low-confidence matches and amounts that can't be converted are left visible for you to fix.
    /// </summary>
    public async Task MatchIngredientsAsync(Recipe recipe, bool onlyUnmatched, CancellationToken ct)
    {
        var cache = new Dictionary<string, List<RankedFood>>(StringComparer.OrdinalIgnoreCase);
        foreach (var ing in recipe.Ingredients)
        {
            if (ing.Status is IngredientMatchStatus.Ignored or IngredientMatchStatus.Confirmed) continue;
            if (onlyUnmatched && ing.Status == IngredientMatchStatus.AutoMatched && ing.Grams is not null) continue;

            if (ing.Amount is null && (ing.Preparation?.Contains("to taste") == true || ing.Preparation?.Contains("optional") == true))
            {
                ing.Status = IngredientMatchStatus.Ignored;
                ing.ResolutionNote = "No amount (to taste / optional) — not counted";
                continue;
            }

            var query = IngredientQuery.Clean(ing.FoodText);
            if (!cache.TryGetValue(query, out var top))
            {
                top = (await foodService.SearchRankedAsync(query, 12, ct, dedupe: false)).ToList();
                cache[query] = top;
            }

            var best = top.FirstOrDefault();
            if (best is null || best.Score < MinAutoMatchScore)
            {
                (ing.FoodId, ing.FoodName, ing.Grams, ing.Status) = (null, null, null, IngredientMatchStatus.Unmatched);
                ing.MatchConfidence = best is null ? 0 : Confidence(best.Score);
                ing.ResolutionNote = "No confident match — pick a food";
                continue;
            }

            // Many lab-analysed foods have no cup/tbsp weights. If the top match can't convert this amount,
            // use the next close match that can (e.g. SR Legacy "Oats" instead of a Foundation sample).
            var q = QuantityResolver.Resolve(best.Food, ing.Amount ?? 1, ing.Unit);
            if (!q.IsResolved)
            {
                foreach (var alternative in top.Skip(1).Where(a => a.Score >= best.Score - 20))
                {
                    var altQ = QuantityResolver.Resolve(alternative.Food, ing.Amount ?? 1, ing.Unit);
                    if (!altQ.IsResolved) continue;
                    (best, q) = (alternative, altQ);
                    break;
                }
            }
            if (!q.IsResolved)
            {
                // Still nothing: borrow the measure from a nutritionally equivalent food ("Oats, raw" has a cup
                // weight; "Oats, rolled" doesn't). Same composition ⇒ same density, so the grams are sound.
                foreach (var alternative in top.Skip(1).Where(a => NutritionallyEquivalent(a.Food, best.Food)))
                {
                    var altQ = QuantityResolver.Resolve(alternative.Food, ing.Amount ?? 1, ing.Unit);
                    if (!altQ.IsResolved) continue;
                    q = altQ with { Explanation = $"{altQ.Explanation} — measure from \"{alternative.Food.Name}\"" };
                    break;
                }
            }

            ing.FoodId = best.Food.Id;
            ing.FoodName = best.Food.DisplayName;
            ing.Grams = q.Grams is null ? null : Math.Round(q.Grams.Value, 2);
            ing.Status = IngredientMatchStatus.AutoMatched;
            ing.MatchConfidence = Confidence(best.Score);
            ing.ResolutionNote = q.Explanation;
        }
        await RecalculateAsync(recipe, ct);
    }

    /// <summary>Within ~8 % on calories and close on each macro: effectively the same food.</summary>
    public static bool NutritionallyEquivalent(Food a, Food b)
    {
        var x = a.NutrientsPer100g; var y = b.NutrientsPer100g;
        static bool Close(double p, double q, double rel, double abs) => Math.Abs(p - q) <= Math.Max(abs, rel * Math.Max(p, q));
        return Close(x.Calories, y.Calories, 0.08, 10) && Close(x.Protein, y.Protein, 0.15, 1.5)
               && Close(x.Carbs, y.Carbs, 0.15, 2) && Close(x.Fat, y.Fat, 0.15, 1.5);
    }

    private static double Confidence(double score) => Math.Round(Math.Clamp((score - 20) / 60, 0, 1), 2);

    private async Task RecalculateAsync(Recipe recipe, CancellationToken ct)
    {
        var foodMap = await foods.GetManyAsync(recipe.Ingredients.Where(i => i.FoodId is not null).Select(i => i.FoodId!.Value), ct);
        recipe.ApplyNutrition(RecipeNutritionCalculator.Calculate(recipe, foodMap));
    }

    private static void Apply(Recipe recipe, SaveRecipeRequest r)
    {
        recipe.SetIngredientLines(r.Ingredients);
        recipe.Directions = r.Directions;
        recipe.Description = r.Description;
        recipe.Notes = r.Notes;
        recipe.CookedWeightGrams = r.CookedWeightGrams;
        if (r.Categories is not null) recipe.SetCategories(r.Categories);
    }

    private async Task<Recipe> Get(Guid id, CancellationToken ct) =>
        await recipes.GetAsync(id, ct) ?? throw new NotFoundException($"Recipe {id} not found.");

    private async Task<RecipeDetailDto> ToDetailAsync(Recipe r, CancellationToken ct)
    {
        var foodMap = await foods.GetManyAsync(r.Ingredients.Where(i => i.FoodId is not null).Select(i => i.FoodId!.Value), ct);
        var nutrition = RecipeNutritionCalculator.Calculate(r, foodMap);
        var ingredients = r.Ingredients.Select(i => new IngredientDto(
            i.Position, i.RawText, i.Amount, i.Unit, i.FoodText, i.Preparation, i.FoodId, i.FoodName, i.Grams,
            i.Status.ToString(), i.MatchConfidence, i.ResolutionNote,
            i.CountsTowardNutrition && foodMap.TryGetValue(i.FoodId!.Value, out var f) ? NutritionDto.From(f.NutrientsFor(i.Grams!.Value)) : null)).ToList();

        return new RecipeDetailDto(RecipeSummaryDto.From(r), r.Description, r.Directions, r.Notes, r.PrepTime, r.CookTime,
            r.SourceName, r.SourceUrl, r.ServingDescription, r.CookedWeightGrams, r.SourceNutritionText, ingredients, nutrition.Warnings);
    }
}
