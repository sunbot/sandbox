using NutriPlan.Application.Abstractions;
using NutriPlan.Application.Common;
using NutriPlan.Application.Foods;
using NutriPlan.Application.Recipes.Import;
using NutriPlan.Domain.Foods;
using NutriPlan.Domain.Recipes;
using NutriPlan.Domain.Units;

namespace NutriPlan.Application.Recipes;

/// <summary>
/// One ingredient line. It is either a food (<c>FoodId</c>, with its <c>FoodSource</c>/<c>FoodQuality</c>) or another of your
/// recipes (<c>RecipeId</c>, <c>Servings</c> of it), or not matched yet.
/// </summary>
public sealed record IngredientDto(
    int Position, string RawText, double? Amount, string? Unit, string FoodText, string? Preparation,
    Guid? FoodId, string? FoodName, double? Grams, string Status, double MatchConfidence, string? Note, NutritionDto? Nutrition,
    Guid? RecipeId = null, string? RecipeName = null, double? Servings = null, string? FoodSource = null, string? FoodQuality = null);

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
    IReadOnlyList<IngredientDto> Ingredients, IReadOnlyList<string> Warnings,
    double? FinishedVolumeMl = null, IReadOnlyList<MeasureDto>? Measures = null, NutritionDto? Total = null, IReadOnlyList<RecipeUseDto>? UsedIn = null);

/// <summary>A recipe that uses this one as an ingredient.</summary>
public sealed record RecipeUseDto(Guid Id, string Name);

public sealed record ImportResultDto(int Imported, int Updated, IReadOnlyList<RecipeSummaryDto> Recipes, IReadOnlyList<string> Errors);

public sealed record SaveRecipeRequest(
    string Name, double Servings, IReadOnlyList<string> Ingredients, string? Directions, string? Description,
    IReadOnlyList<string>? Categories, string? Notes, double? CookedWeightGrams, double? FinishedVolumeMl = null);

/// <summary>
/// Point an ingredient at a food (<c>FoodId</c>, amount as <c>Grams</c> or <c>Amount</c>+<c>Unit</c>), at another of your recipes
/// (<c>RecipeId</c>, amount as <c>Servings</c> or <c>Amount</c>+<c>Unit</c> in its measures), or exclude it (<c>Ignore</c>).
/// </summary>
public sealed record UpdateIngredientRequest(Guid? FoodId, double? Grams, double? Amount, string? Unit, bool? Ignore, Guid? RecipeId = null, double? Servings = null);

public sealed partial class RecipeService(
    IRecipeRepository recipes,
    IFoodRepository foods,
    FoodService foodService,
    IWebPageFetcher fetcher,
    IUnitOfWork uow)
{
    /// <summary>Catches a typo (a misplaced zero) in how many servings of a recipe go into another.</summary>
    public const double MaxIngredientServings = 500;

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
        recipe.ServingDescription = $"{request.Servings:0.##} (set by you)";
        recipe.Directions = request.Directions;
        recipe.Description = request.Description;
        recipe.Notes = request.Notes;
        recipe.CookedWeightGrams = Positive(request.CookedWeightGrams, "finished weight");
        recipe.FinishedVolumeMl = Positive(request.FinishedVolumeMl, "finished volume");
        if (request.Categories is not null) recipe.SetCategories(request.Categories);
        if (!oldLines.SequenceEqual(request.Ingredients.Select(l => l.Trim()).Where(l => l.Length > 0)))
        {
            // Unchanged lines you confirmed or excluded keep their choice (even if lines moved); new or edited lines are matched.
            recipe.ReparseIngredients(request.Ingredients);
            await MatchIngredientsAsync(recipe, onlyUnmatched: true, ct);
        }
        await RecalculateAsync(recipe, ct);
        await PropagateAsync([recipe], ct);
        await uow.SaveChangesAsync(ct);
        return await ToDetailAsync(recipe, ct);
    }

    /// <summary>A recipe used inside another can't be deleted (that one's nutrition would silently lose it): remove it there first.</summary>
    public async Task DeleteAsync(Guid id, CancellationToken ct = default)
    {
        var recipe = await Get(id, ct);
        var users = (await recipes.LinksAsync(ct)).Where(r => r.Id != id && r.Uses.Contains(id)).Select(r => $"“{r.Name}”").ToList();
        if (users.Count > 0)
            throw new ValidationException($"“{recipe.Name}” is an ingredient of {string.Join(", ", users)}. Remove it there first.");
        recipes.Remove(recipe);
        await uow.SaveChangesAsync(ct);
    }

    public async Task<RecipeSummaryDto> SetFavoriteAsync(Guid id, bool favorite, CancellationToken ct = default)
    {
        var recipe = await Get(id, ct);
        recipe.IsFavorite = favorite;
        await uow.SaveChangesAsync(ct);
        return RecipeSummaryDto.From(recipe);
    }

    /// <summary>Point an ingredient at a different food or one of your recipes and/or amount, or exclude it.</summary>
    public async Task<RecipeDetailDto> UpdateIngredientAsync(Guid id, int position, UpdateIngredientRequest r, CancellationToken ct = default)
    {
        var recipe = await Get(id, ct);
        var ing = recipe.GetIngredient(position);
        if (r.Ignore == true)
        {
            ing.Status = IngredientMatchStatus.Ignored;
            ing.ResolutionNote = "Excluded by you";
        }
        else if ((r.RecipeId ?? (r.FoodId is null ? ing.RecipeId : null)) is { } subId)
        {
            var sub = await recipes.GetAsync(subId, ct) ?? throw new NotFoundException($"Recipe {subId} not found.");
            if (subId == recipe.Id) throw new ValidationException("A recipe can't be an ingredient of itself.");
            var links = (await recipes.LinksAsync(ct)).ToDictionary(x => x.Id);
            links[recipe.Id] = new RecipeLink(recipe.Id, recipe.Name, recipe.SubRecipeIds.ToList());
            if (RecipeGraph.PathTo(subId, recipe.Id, x => links.TryGetValue(x, out var l) ? l.Uses : []) is { } loop)
                throw new ValidationException($"“{sub.Name}” already uses “{recipe.Name}” ({string.Join(" → ", loop.Select(x => $"“{links[x].Name}”"))}), so it can't also be an ingredient of it.");
            if (r.Grams is not null) throw new ValidationException("A recipe ingredient is measured in its servings (or by weight/volume through Amount and Unit), not Grams.");
            RecipeAmount amount;
            if (r.Servings is { } sv)
                amount = sv > 0 ? RecipeMeasures.Resolve(sub, sv, RecipeMeasures.Serving) : new RecipeAmount(null, null, "Enter an amount greater than zero.");
            else if (r.Amount is { } given) amount = RecipeMeasures.Resolve(sub, given, r.Unit);
            // No amount sent: keep the line's own amount in its own measure ("250 g" stays 250 g of the new recipe);
            // a line with no amount (or a recipe line saved in servings only) uses its servings, else 1 serving.
            else if (ing.Amount is { } own) amount = RecipeMeasures.Resolve(sub, own, ing.Unit);
            else amount = RecipeMeasures.Resolve(sub, ing.Servings ?? 1, RecipeMeasures.Serving);
            if (!amount.IsResolved) throw new ValidationException(amount.Explanation);
            if (amount.Servings > MaxIngredientServings) throw new ValidationException("That's a lot of servings for one ingredient. Check the amount.");
            ing.UseRecipe(sub.Id, sub.Name, Math.Round(amount.Servings!.Value, 4), amount.Grams is { } gg ? Math.Round(gg, 2) : null);
            if (r.Servings is { } s2) (ing.Amount, ing.Unit) = (s2, RecipeMeasures.Serving);
            else if (r.Amount is not null) (ing.Amount, ing.Unit) = (r.Amount, r.Unit);
            ing.Status = IngredientMatchStatus.Confirmed;
            ing.MatchConfidence = 1;
            ing.ResolutionNote = $"Your recipe: {amount.Explanation}";
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
            ing.UseFood(food.Id, food.DisplayName, grams);
            if (r.Amount is not null) (ing.Amount, ing.Unit) = (r.Amount, r.Unit);
            ing.Status = grams is null ? IngredientMatchStatus.AutoMatched : IngredientMatchStatus.Confirmed;
            ing.MatchConfidence = 1;
            ing.ResolutionNote = r.Grams is not null ? $"{r.Grams:0.#} g entered by you" : note;
        }
        await RecalculateAsync(recipe, ct);
        await PropagateAsync([recipe], ct);
        await uow.SaveChangesAsync(ct);
        return await ToDetailAsync(recipe, ct);
    }

    public async Task<RecipeDetailDto> RematchAsync(Guid id, CancellationToken ct = default)
    {
        var recipe = await Get(id, ct);
        recipe.ReparseIngredients(); // latest parsing rules; your confirmed/excluded lines are kept
        await MatchIngredientsAsync(recipe, onlyUnmatched: false, ct);
        await PropagateAsync([recipe], ct);
        await uow.SaveChangesAsync(ct);
        return await ToDetailAsync(recipe, ct);
    }

    /// <summary>How many servings the whole recipe makes. Per-serving nutrition is recalculated; ingredients don't change.</summary>
    public async Task<RecipeDetailDto> SetServingsAsync(Guid id, double servings, CancellationToken ct = default)
    {
        if (servings is <= 0 or > 500) throw new ValidationException("Servings must be between 0 and 500.");
        var recipe = await Get(id, ct);
        recipe.SetServings(servings);
        recipe.ServingDescription = $"{servings:0.##} (set by you)";
        await RecalculateAsync(recipe, ct);
        await PropagateAsync([recipe], ct);
        await uow.SaveChangesAsync(ct);
        return await ToDetailAsync(recipe, ct);
    }

    public async Task<ImportResultDto> ImportPaprikaAsync(Stream file, CancellationToken ct = default)
    {
        IReadOnlyList<ImportedRecipe> imported;
        IReadOnlyList<string> readErrors;
        try { (imported, readErrors) = PaprikaImporter.ReadAll(file); }
        catch (Exception ex) when (ex is InvalidDataException or System.Text.Json.JsonException)
        {
            throw new ValidationException($"That doesn't look like a Paprika export (.paprikarecipes / .paprikarecipe): {ex.Message}");
        }
        if (imported.Count == 0)
            throw new ValidationException(readErrors.Count > 0
                ? $"No recipes could be read from that file. {readErrors[0]}"
                : "That file has no recipes in it. Export from Paprika with “Paprika Recipe Format” (.paprikarecipes).");
        var result = await SaveImportedAsync(imported, RecipeOrigin.Paprika, ct);
        return readErrors.Count == 0 ? result : result with { Errors = [.. result.Errors, .. readErrors] };
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
        var searchCache = new Dictionary<string, List<RankedFood>>(StringComparer.OrdinalIgnoreCase); // "onion" is searched once per import, not once per recipe

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
                    if (item.Servings is > 0 && recipe.ServingDescription?.EndsWith("(set by you)") != true) recipe.SetServings(item.Servings.Value); // your own servings win
                    updated++;
                }

                if (item.ServingsText is not null || recipe.ServingDescription?.EndsWith("(set by you)") != true)
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
                // Re-importing refreshes matches with the current rules (fixes from app updates apply to recipes you
                // already have); lines you confirmed or excluded yourself are kept.
                recipe.ReparseIngredients(item.IngredientLines);

                await MatchIngredientsAsync(recipe, onlyUnmatched: false, ct, searchCache);
                saved.Add(recipe);
            }
            catch (Exception ex) when (ex is ArgumentException or ValidationException)
            {
                errors.Add($"{item.Name}: {ex.Message}");
            }
        }

        await PropagateAsync(saved, ct);
        await uow.SaveChangesAsync(ct);
        return new ImportResultDto(created, updated, saved.Select(RecipeSummaryDto.From).ToList(), errors);
    }

    /// <summary>
    /// Matches each ingredient to the best food and converts its amount to grams.
    /// Low-confidence matches and amounts that can't be converted are left visible for you to fix.
    /// </summary>
    public async Task MatchIngredientsAsync(Recipe recipe, bool onlyUnmatched, CancellationToken ct,
        Dictionary<string, List<RankedFood>>? cache = null)
    {
        cache ??= new Dictionary<string, List<RankedFood>>(StringComparer.OrdinalIgnoreCase);
        async Task<List<RankedFood>> SearchCachedAsync(string q)
        {
            if (!cache.TryGetValue(q, out var found))
            {
                // Ingredients are weighed or measured into grams: drinks labelled per 100 ml can't be summed by weight.
                found = (await foodService.SearchRankedAsync(q, 12, ct, dedupe: false, useHistory: false, assumeCookedStaples: false)).Where(r => !r.Food.IsVolume).ToList();
                cache[q] = found;
            }
            return found;
        }

        foreach (var ing in recipe.Ingredients)
        {
            if (ing.Status is IngredientMatchStatus.Ignored or IngredientMatchStatus.Confirmed) continue;
            if (ing.IsRecipe) continue; // one of your recipes, chosen by you: never re-matched to a food
            if (onlyUnmatched && ing.Status == IngredientMatchStatus.AutoMatched && ing.Grams is not null) continue;

            if (IngredientQuery.IsNeverCounted(ing.RawText))
            {
                (ing.FoodId, ing.FoodName, ing.Grams) = (null, null, null);
                ing.Status = IngredientMatchStatus.Ignored;
                ing.ResolutionNote = "Not a separate ingredient (reserved liquid / zest only) — not counted";
                continue;
            }

            if (ing.Amount is null && IngredientQuery.IsMinorWithoutAmount(ing.RawText, ing.FoodText))
            {
                // "Kosher salt", "Lime wedges, for serving", "Oil for the pan": no amount to count, and not a real portion.
                (ing.FoodId, ing.FoodName, ing.Grams) = (null, null, null);
                ing.Status = IngredientMatchStatus.Ignored;
                ing.ResolutionNote = "No amount (to taste / for serving) — not counted";
                continue;
            }

            // Search the food words; a known recipe term may only show up with the preparation ("sunflower, safflower or canola oil").
            var query = IngredientQuery.Alias(ing.FoodText) is null && ing.Preparation is not null && IngredientQuery.Alias($"{ing.FoodText} {ing.Preparation}") is { } fromPrep
                ? fromPrep
                : IngredientQuery.Clean(ing.FoodText);
            var top = await SearchCachedAsync(query);
            var best = top.FirstOrDefault();

            // Nothing confident: try the main noun ("toasted sesame oil" → "sesame oil", "Dijon mustard" → "mustard"),
            // keeping it only if the food found is that noun ("Sugars, brown" for "brown sugar", not "Rice" for "rice vinegar").
            if (best is null || best.Score < MinAutoMatchScore)
            {
                foreach (var shorter in IngredientQuery.ShorterQueries(query))
                {
                    var alt = (await SearchCachedAsync(shorter)).FirstOrDefault();
                    if (alt is null || alt.Score < MinAutoMatchScore || !IngredientQuery.NamesTheFood(alt.Food.Name, shorter)) continue;
                    (best, top) = (alt, await SearchCachedAsync(shorter));
                    break;
                }
            }
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
            if (!q.IsResolved || QuantityResolver.IsPartGuess(q))
            {
                // Many lab-analysed foods have no cup/tbsp weights. Use the next close match of the same kind that can
                // convert the amount ("Oats" for "Oats, rolled") — never a different food that happens to have the
                // measure (that's how "olive oil" once became mayonnaise). A whole-item measure beats a piece ("1 pepper"
                // is a pepper, not a 10 g ring).
                var options = top.Skip(1)
                    .Where(a => a.Score >= best.Score - 20 && (SameHead(a.Food, best.Food) || NutritionallyEquivalent(a.Food, best.Food)))
                    .Select(a => (Food: a, Q: QuantityResolver.Resolve(a.Food, ing.Amount ?? 1, ing.Unit)))
                    .Where(x => x.Q.IsResolved)
                    .ToList();
                var pick = options.FirstOrDefault(x => !QuantityResolver.IsPartGuess(x.Q));
                if (pick.Food is not null) (best, q) = (pick.Food, pick.Q);
                else if (!q.IsResolved && options.Count > 0) (best, q) = (options[0].Food, options[0].Q);
            }
            if (!q.IsResolved)
            {
                // Still nothing: borrow the measure from a nutritionally equivalent food ("Oats, raw" has a cup
                // weight; "Oats, rolled" doesn't). Same composition ⇒ same density, so the grams are sound.
                foreach (var alternative in top.Skip(1).Where(a => NutritionallyEquivalent(a.Food, best.Food) && SameHead(a.Food, best.Food)))
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
            // A known recipe term ("80/20 ground beef" → USDA's name for it) that found its food is a sure match.
            ing.MatchConfidence = IngredientQuery.Alias(ing.FoodText) is not null && best.Score >= MinAutoMatchScore + 10
                ? Math.Max(0.8, Confidence(best.Score))
                : Confidence(best.Score);
            ing.ResolutionNote = q.Explanation;
            // Notes in parentheses count too: "1 lb smoked turkey (necks, legs or wings)".
            if ((IngredientQuery.StandIn(ing.FoodText) ?? (IngredientQuery.Alias(ing.FoodText) is not null ? IngredientQuery.StandIn(ing.RawText) : null)) is { } standIn)
            {
                // A close substitute, not the same food: counted, but highlighted so you can confirm or pick another.
                ing.MatchConfidence = Math.Min(ing.MatchConfidence, 0.4);
                ing.ResolutionNote = $"Stand-in: {standIn} — check it's close enough. {q.Explanation}";
            }
            else if (IngredientQuery.WeightIncludesBone(ing.RawText) && ing.Grams is not null)
            {
                ing.MatchConfidence = Math.Min(ing.MatchConfidence, 0.4);
                ing.ResolutionNote = $"This weight includes bone, so it overcounts — enter the edible weight if you know it. {q.Explanation}";
            }
        }
        await RecalculateAsync(recipe, ct);
    }

    /// <summary>Same food named the same way: "Oats, rolled" and "Oats" (first word of the USDA name).</summary>
    private static bool SameHead(Food a, Food b)
    {
        static string Head(Food f) => FoodRanker.Stem(f.Name.Split(',', ' ')[0].Trim().ToLowerInvariant());
        return Head(a) == Head(b);
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
        var subs = await recipes.GetManyAsync(recipe.SubRecipeIds, ct);
        recipe.ApplyNutrition(RecipeNutritionCalculator.Calculate(recipe, foodMap, subs));
    }

    /// <summary>
    /// After recipes change, recalculates every recipe that uses them (directly or through others), innermost first, so
    /// an edit to a sauce shows up in the lasagne that uses it and in the meal plan entry made from that lasagne next time.
    /// A nested amount given by weight or volume is converted again through the changed recipe's finished weight or volume.
    /// Diary and plan entries already made keep their own snapshot.
    /// </summary>
    private async Task PropagateAsync(IReadOnlyCollection<Recipe> changed, CancellationToken ct)
    {
        if (changed.Count == 0) return;
        // The graph from links (no photos or details); only the recipes that need recalculating are loaded in full.
        var uses = (await recipes.LinksAsync(ct)).ToDictionary(l => l.Id, l => (IReadOnlyCollection<Guid>)l.Uses);
        foreach (var c in changed) uses[c.Id] = c.SubRecipeIds.ToList();
        var order = RecipeGraph.DependentsInOrder(changed.Select(c => c.Id), uses);
        if (order.Count == 0) return;
        var needed = order.Concat(order.SelectMany(id => uses.GetValueOrDefault(id) ?? [])).Distinct().ToList();
        var byId = (await recipes.GetManyAsync(needed, ct)).ToDictionary(kv => kv.Key, kv => kv.Value);
        foreach (var c in changed) byId[c.Id] = c;
        foreach (var id in order)
        {
            if (!byId.TryGetValue(id, out var parent)) continue;
            foreach (var ing in parent.Ingredients.Where(i => i.IsRecipe && i.Status != IngredientMatchStatus.Ignored))
            {
                if (!byId.TryGetValue(ing.RecipeId!.Value, out var sub)) continue;
                ing.RecipeName = sub.Name;
                var a = ing.Amount is { } amt ? RecipeMeasures.Resolve(sub, amt, ing.Unit) : null;
                if (a is { IsResolved: true }) (ing.Servings, ing.Grams) = (Math.Round(a.Servings!.Value, 4), a.Grams is { } g ? Math.Round(g, 2) : null);
                else if (a is not null)
                {
                    // Given by weight/volume, and the recipe no longer has that finished weight/volume: don't keep counting
                    // an old conversion silently. The line stops counting until you choose an amount (shown as "check").
                    (ing.Servings, ing.Grams) = (null, null);
                    ing.Status = IngredientMatchStatus.AutoMatched;
                    ing.MatchConfidence = 0;
                    ing.ResolutionNote = $"{a.Explanation} Choose an amount for this line.";
                }
                else ing.Grams = ing.Servings is { } sv && sub.GramsPerServing is { } gps ? Math.Round(sv * gps, 2) : null;
            }
            var foodMap = await foods.GetManyAsync(parent.Ingredients.Where(i => i.FoodId is not null).Select(i => i.FoodId!.Value), ct);
            parent.ReplaceIngredients(parent.Ingredients.ToList()); // marks the changed ingredient list for saving
            parent.ApplyNutrition(RecipeNutritionCalculator.Calculate(parent, foodMap, byId));
        }
    }

    private static double? Positive(double? value, string what) => value switch
    {
        null => null,
        <= 0 => null,
        > 1_000_000 => throw new ValidationException($"That {what} is too large. Check the amount."),
        _ => value,
    };

    private static void Apply(Recipe recipe, SaveRecipeRequest r)
    {
        recipe.SetIngredientLines(r.Ingredients);
        recipe.Directions = r.Directions;
        recipe.Description = r.Description;
        recipe.Notes = r.Notes;
        recipe.CookedWeightGrams = Positive(r.CookedWeightGrams, "finished weight");
        recipe.FinishedVolumeMl = Positive(r.FinishedVolumeMl, "finished volume");
        if (r.Categories is not null) recipe.SetCategories(r.Categories);
    }

    private async Task<Recipe> Get(Guid id, CancellationToken ct) =>
        await recipes.GetAsync(id, ct) ?? throw new NotFoundException($"Recipe {id} not found.");

    private async Task<RecipeDetailDto> ToDetailAsync(Recipe r, CancellationToken ct)
    {
        var foodMap = await foods.GetManyAsync(r.Ingredients.Where(i => i.FoodId is not null).Select(i => i.FoodId!.Value), ct);
        var subs = await recipes.GetManyAsync(r.SubRecipeIds, ct);
        var nutrition = RecipeNutritionCalculator.Calculate(r, foodMap, subs);
        var ingredients = r.Ingredients.Select(i =>
        {
            Food? f = i.FoodId is { } fid ? foodMap.GetValueOrDefault(fid) : null;
            Recipe? sub = i.RecipeId is { } rid ? subs.GetValueOrDefault(rid) : null;
            NutritionDto? n = !i.CountsTowardNutrition ? null
                : sub is not null ? NutritionDto.From(sub.NutritionPerServing.Scale(i.Servings!.Value))
                : f is not null && i.Grams is { } g ? NutritionDto.From(f.NutrientsFor(g)) : null;
            return new IngredientDto(
                i.Position, i.RawText, i.Amount, i.Unit, i.FoodText, i.Preparation, i.FoodId, i.FoodName, i.Grams,
                i.Status.ToString(), i.MatchConfidence, i.ResolutionNote, n,
                i.RecipeId, sub?.Name ?? i.RecipeName, i.Servings, f?.Source.ToString(), f?.Quality.ToString());
        }).ToList();
        var usedIn = (await recipes.LinksAsync(ct)).Where(x => x.Id != r.Id && x.Uses.Contains(r.Id)).Select(x => new RecipeUseDto(x.Id, x.Name)).ToList();

        return new RecipeDetailDto(RecipeSummaryDto.From(r), r.Description, r.Directions, r.Notes, r.PrepTime, r.CookTime,
            r.SourceName, r.SourceUrl, r.ServingDescription, r.CookedWeightGrams, r.SourceNutritionText, ingredients, nutrition.Warnings,
            r.FinishedVolumeMl, RecipeMeasuresDto(r), NutritionDto.From(nutrition.Total.Rounded()), usedIn);
    }

    public static IReadOnlyList<MeasureDto> RecipeMeasuresDto(Recipe r) =>
        RecipeMeasures.For(r).Select(m => new MeasureDto(m.Unit, m.Label, m.Plural, m.BasePerUnit, m.Kind.ToString(), m.Source, m.Countable, "your recipe")).ToList();
}
