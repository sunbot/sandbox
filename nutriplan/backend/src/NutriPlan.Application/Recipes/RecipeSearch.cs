using NutriPlan.Application.Foods;
using NutriPlan.Domain.Recipes;

namespace NutriPlan.Application.Recipes;

/// <summary>What a recipe search matched on, best first: the name, then a category, an ingredient line, the description.</summary>
public enum RecipeMatchField { Name = 0, Category = 1, Ingredient = 2, Description = 3 }

/// <summary>
/// Searching your recipes (#84). Every word must appear (or start a word) somewhere in the recipe. The result says where, so
/// a recipe found through an ingredient ("apple" → "1 tbsp apple cider vinegar") is labelled as such and ranked after recipes
/// whose name matches.
/// </summary>
public static class RecipeSearch
{
    public sealed record Hit(RecipeMatchField Field, string? Text);

    public static Hit? Match(Recipe r, string search)
    {
        var words = FoodRanker.Tokens(search).ToList();
        if (words.Count == 0) return new Hit(RecipeMatchField.Name, null);
        static bool Has(IEnumerable<string> tokens, string w) => tokens.Any(h => h == w || h.StartsWith(w));
        var name = FoodRanker.Tokens(r.Name).ToList();
        if (words.All(w => Has(name, w))) return new Hit(RecipeMatchField.Name, null);

        // Each word found somewhere; report the field of the first word not in the name (the one that explains the match).
        var categories = r.Categories.ToDictionary(c => c, c => FoodRanker.Tokens(c).ToList());
        var lines = r.Ingredients.Where(i => !string.IsNullOrWhiteSpace(i.RawText)).Select(i => (Text: i.RawText, Tokens: FoodRanker.Tokens(i.RawText).ToList())).ToList();
        var description = FoodRanker.Tokens(r.Description ?? "").ToList();
        Hit? why = null;
        foreach (var w in words)
        {
            if (Has(name, w)) continue;
            Hit? found = categories.FirstOrDefault(c => Has(c.Value, w)) is { Key: { } cat } ? new Hit(RecipeMatchField.Category, cat)
                : lines.FirstOrDefault(l => Has(l.Tokens, w)) is { Text: { } line } ? new Hit(RecipeMatchField.Ingredient, line)
                : Has(description, w) ? new Hit(RecipeMatchField.Description, null)
                : null;
            if (found is null) return null;
            if (why is null || found.Field > why.Field) why = found; // the weakest field decides how it's labelled and ranked
        }
        return why;
    }

    /// <summary>The recipes that match, name matches first, keeping the incoming order within each group.</summary>
    public static IReadOnlyList<(Recipe Recipe, Hit Hit)> Filter(IEnumerable<Recipe> recipes, string? search) =>
        string.IsNullOrWhiteSpace(search)
            ? recipes.Select(r => (r, new Hit(RecipeMatchField.Name, null))).ToList()
            : recipes.Select((r, i) => (Recipe: r, Hit: Match(r, search), I: i)).Where(x => x.Hit is not null)
                .OrderBy(x => x.Hit!.Field).ThenBy(x => x.I).Select(x => (x.Recipe, x.Hit!)).ToList();
}
