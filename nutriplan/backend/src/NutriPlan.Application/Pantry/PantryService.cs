using NutriPlan.Application.Abstractions;
using NutriPlan.Application.Common;
using NutriPlan.Application.Foods;
using NutriPlan.Application.Recipes;
using NutriPlan.Domain.Pantry;
using NutriPlan.Domain.Recipes;

namespace NutriPlan.Application.Pantry;

public sealed record PantryItemDto(Guid Id, string Name, Guid? FoodId, double? Grams, DateOnly? ExpiresOn, bool IsStaple)
{
    public static PantryItemDto From(PantryItem p) => new(p.Id, p.Name, p.FoodId, p.Grams, p.ExpiresOn, p.IsStaple);
}

public sealed record SavePantryItemRequest(string Name, Guid? FoodId, double? Grams, DateOnly? ExpiresOn, bool IsStaple = false);

public sealed record CookableRecipeDto(RecipeSummaryDto Recipe, double MatchPercent, IReadOnlyList<string> Have, IReadOnlyList<string> Missing, bool UsesExpiringSoon);

/// <summary>Pantry + "what can I make with what I have?".</summary>
public sealed class PantryService(IPantryRepository pantry, IRecipeRepository recipes, IClock clock, IUnitOfWork uow)
{
    /// <summary>Assumed to be in every kitchen; never counted as missing. Mark more items as staples in the pantry.</summary>
    public static readonly HashSet<string> AssumedStaples =
    [
        "salt", "pepper", "black pepper", "water", "ice", "kosher salt", "sea salt", "cooking spray", "oil", "vegetable oil",
        "olive oil", "canola oil", "sugar", "flour", "all-purpose flour", "baking soda", "baking powder",
    ];

    public async Task<IReadOnlyList<PantryItemDto>> ListAsync(CancellationToken ct = default) =>
        (await pantry.ListAsync(ct)).OrderBy(p => p.ExpiresOn ?? DateOnly.MaxValue).ThenBy(p => p.Name).Select(PantryItemDto.From).ToList();

    public async Task<PantryItemDto> AddAsync(SavePantryItemRequest r, CancellationToken ct = default)
    {
        var item = new PantryItem(r.Name, r.FoodId, r.Grams, r.ExpiresOn) { IsStaple = r.IsStaple };
        pantry.Add(item);
        await uow.SaveChangesAsync(ct);
        return PantryItemDto.From(item);
    }

    public async Task<PantryItemDto> UpdateAsync(Guid id, SavePantryItemRequest r, CancellationToken ct = default)
    {
        var item = await pantry.GetAsync(id, ct) ?? throw new NotFoundException($"Pantry item {id} not found.");
        item.Update(r.Name, r.FoodId, r.Grams, r.ExpiresOn);
        item.IsStaple = r.IsStaple;
        await uow.SaveChangesAsync(ct);
        return PantryItemDto.From(item);
    }

    public async Task DeleteAsync(Guid id, CancellationToken ct = default)
    {
        var item = await pantry.GetAsync(id, ct) ?? throw new NotFoundException($"Pantry item {id} not found.");
        pantry.Remove(item);
        await uow.SaveChangesAsync(ct);
    }

    /// <summary>
    /// Ranks recipes by how much of them you can make from the pantry. An ingredient counts as "have"
    /// when it's linked to the same food, or its words match a pantry item name ("chicken thighs" ↔ "chicken").
    /// </summary>
    public async Task<IReadOnlyList<CookableRecipeDto>> WhatCanIMakeAsync(int maxMissing = 3, string? search = null, CancellationToken ct = default)
    {
        var items = await pantry.ListAsync(ct);
        var all = await recipes.ListAsync(search, ct: ct);
        var soon = clock.Today.AddDays(3);
        var result = new List<CookableRecipeDto>();

        foreach (var recipe in all)
        {
            var have = new List<string>();
            var missing = new List<string>();
            var expiring = false;

            foreach (var ing in recipe.Ingredients.Where(i => i.Status != IngredientMatchStatus.Ignored))
            {
                if (IsStaple(ing.FoodText, items)) continue;
                var match = items.FirstOrDefault(p => !p.IsStaple && Matches(ing, p));
                if (match is null) { missing.Add(ing.FoodText); continue; }
                have.Add(ing.FoodText);
                if (match.ExpiresOn is { } e && e <= soon) expiring = true;
            }

            var counted = have.Count + missing.Count;
            if (counted == 0 || missing.Count > maxMissing || have.Count == 0) continue;
            result.Add(new CookableRecipeDto(RecipeSummaryDto.From(recipe), Math.Round(100.0 * have.Count / counted, 0), have, missing, expiring));
        }

        return result
            .OrderBy(r => r.Missing.Count)
            .ThenByDescending(r => r.UsesExpiringSoon)
            .ThenByDescending(r => r.MatchPercent)
            .ThenByDescending(r => r.Recipe.IsFavorite)
            .ToList();
    }

    private static bool IsStaple(string foodText, IReadOnlyList<PantryItem> items)
    {
        var text = foodText.Trim().ToLowerInvariant();
        return AssumedStaples.Contains(text)
               || AssumedStaples.Any(s => text == s + "s")
               || items.Any(p => p.IsStaple && WordsMatch(text, p.Name.ToLowerInvariant()));
    }

    private static bool Matches(RecipeIngredient ing, PantryItem item)
    {
        if (ing.FoodId is not null && item.FoodId == ing.FoodId) return true;
        return WordsMatch(ing.FoodText.ToLowerInvariant(), item.Name.ToLowerInvariant());
    }

    /// <summary>Every significant word of the pantry name appears in the ingredient text (stemmed).</summary>
    private static bool WordsMatch(string ingredientText, string pantryName)
    {
        var ingredientWords = FoodRanker.Tokens(ingredientText).ToHashSet();
        var pantryWords = FoodRanker.Tokens(pantryName).ToList();
        return pantryWords.Count > 0 && pantryWords.All(ingredientWords.Contains);
    }
}
