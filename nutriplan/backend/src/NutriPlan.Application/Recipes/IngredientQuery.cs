using System.Text.RegularExpressions;

namespace NutriPlan.Application.Recipes;

/// <summary>
/// Strips recipe-writing words that aren't part of a food's database name before searching:
/// "4 cups broccoli florets" → "broccoli", "1 cup butter, softened" → "butter".
/// Words that *do* change nutrition (boneless, skinless, ground, whole, low-fat, cooked…) are kept.
/// </summary>
public static partial class IngredientQuery
{
    private static readonly HashSet<string> Noise = new(StringComparer.OrdinalIgnoreCase)
    {
        "florets", "floret", "chopped", "diced", "minced", "sliced", "shredded", "grated", "fresh", "freshly", "packed",
        "softened", "melted", "divided", "large", "small", "medium", "finely", "roughly", "coarsely", "thinly", "peeled",
        "trimmed", "cubed", "organic", "extra-virgin", "virgin", "extra", "heaping", "level", "scant", "about", "approximately",
        "room", "temperature", "cold", "warm", "hot", "optional", "good", "quality", "best", "store-bought", "homemade",
        "plus", "more", "needed", "torn", "crushed", "julienned", "halved", "quartered", "rinsed", "drained", "patted", "dry",
        "pieces", "piece", "inch", "bite-size", "bite-sized", "into", "cut", "for", "serving", "garnish", "lightly", "beaten",
    };

    public static string Clean(string foodText)
    {
        var words = WordSplit().Split(foodText).Where(w => w.Length > 0 && !Noise.Contains(w)).ToList();
        var cleaned = string.Join(' ', words).Trim();
        return cleaned.Length >= 2 ? cleaned : foodText;
    }

    [GeneratedRegex(@"[\s,;]+")]
    private static partial Regex WordSplit();
}
