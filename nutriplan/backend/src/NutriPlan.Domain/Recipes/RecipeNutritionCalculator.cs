using NutriPlan.Domain.Foods;
using NutriPlan.Domain.Nutrients;

namespace NutriPlan.Domain.Recipes;

public sealed record RecipeNutrition(
    NutrientProfile Total,
    NutrientProfile PerServing,
    double Coverage,
    IReadOnlyList<string> Warnings);

/// <summary>
/// Computes a recipe's nutrition by summing each matched ingredient's grams × the food's per-100 g data.
/// Nutrition is always derived from ingredient data, never from what the source claims.
/// </summary>
public static class RecipeNutritionCalculator
{
    public static RecipeNutrition Calculate(Recipe recipe, IReadOnlyDictionary<Guid, Food> foods)
    {
        var warnings = new List<string>();
        var total = NutrientProfile.Empty;
        var countable = 0;
        var counted = 0;

        foreach (var ingredient in recipe.Ingredients)
        {
            if (ingredient.Status == IngredientMatchStatus.Ignored) continue;
            countable++;

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

        var coverage = countable == 0 ? 1 : (double)counted / countable;
        return new RecipeNutrition(total, total.Scale(1 / recipe.Servings), coverage, warnings);
    }
}
