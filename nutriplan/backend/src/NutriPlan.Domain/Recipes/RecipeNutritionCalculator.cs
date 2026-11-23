using NutriPlan.Domain.Foods;
using NutriPlan.Domain.Nutrients;

namespace NutriPlan.Domain.Recipes;

public sealed record RecipeNutrition(
    NutrientProfile Total,
    NutrientProfile PerServing,
    double Coverage,
    IReadOnlyList<string> Warnings);

/// <summary>
/// Computes a recipe's nutrition by summing each matched ingredient's grams × the food's per-100 g data, and for an
/// ingredient that is another recipe, its servings × that recipe's per-serving nutrition (itself calculated this way, so
/// nesting goes as deep as recipes do). Nutrition is always derived from ingredient data, never from what the source claims.
/// A nutrient no ingredient reports stays absent (unknown), never zero.
/// </summary>
public static class RecipeNutritionCalculator
{
    public static RecipeNutrition Calculate(Recipe recipe, IReadOnlyDictionary<Guid, Food> foods, IReadOnlyDictionary<Guid, Recipe>? subRecipes = null)
    {
        var warnings = new List<string>();
        var total = NutrientProfile.Empty;
        var countable = 0;
        var counted = 0.0;

        foreach (var ingredient in recipe.Ingredients)
        {
            if (ingredient.Status == IngredientMatchStatus.Ignored) continue;
            countable++;

            if (ingredient.IsRecipe)
            {
                if (!ingredient.CountsTowardNutrition)
                {
                    warnings.Add($"Amount unknown for \"{ingredient.RawText}\".");
                    continue;
                }
                if (subRecipes is null || !subRecipes.TryGetValue(ingredient.RecipeId!.Value, out var sub))
                {
                    warnings.Add($"Recipe for \"{ingredient.RawText}\" no longer exists.");
                    continue;
                }
                total += sub.NutritionPerServing.Scale(ingredient.Servings!.Value);
                // A nested recipe counts as far as its own ingredients do: a half-matched one is half counted.
                counted += Math.Clamp(sub.NutritionCoverage, 0, 1);
                if (sub.NutritionCoverage < 1)
                    warnings.Add($"\"{sub.Name}\" has ingredients without nutrition, so its numbers are a minimum.");
                continue;
            }

            if (!ingredient.CountsTowardNutrition)
            {
                warnings.Add(ingredient.FoodId is null
                    ? $"No food matched for \"{ingredient.RawText}\"."
                    : $"Amount unknown for \"{ingredient.RawText}\".");
                continue;
            }

            if (!foods.TryGetValue(ingredient.FoodId!.Value, out var food))
            {
                warnings.Add($"Food for \"{ingredient.RawText}\" no longer exists.");
                continue;
            }

            total += food.NutrientsFor(ingredient.Grams!.Value);
            counted++;
        }

        var coverage = countable == 0 ? 1 : counted / countable;
        return new RecipeNutrition(total, total.Scale(1 / recipe.Servings), coverage, warnings);
    }
}
