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
        "bone-in", "skin-on", "homestyle", "jarred", "store", "bought", "searing", "frying", "drizzling", "brushing",
    };

    /// <summary>
    /// Everyday recipe words → how USDA names the same food. Checked in order; the first match replaces the whole query.
    /// Only foods whose nutrition is the same (or a close stand-in, noted below) belong here.
    /// </summary>
    private static readonly (Regex Pattern, string Query)[] Aliases =
    [
        (Rx(@"\b(\d{2})\s*/\s*(\d{1,2})\b.*\bground beef\b|\bground beef\b.*\b(\d{2})\s*/\s*(\d{1,2})\b"), "{beef}"),
        (Rx(@"\b(\d{2})\s*%\s*lean\b.*\bground beef\b"), "{beefpct}"),
        (Rx(@"\b(lean|extra lean)\s+ground beef\b"), "beef ground 90 lean meat 10 fat raw"),
        (Rx(@"\b(ground beef|hamburger meat|minced beef|beef mince)\b"), "beef ground 80 lean meat 20 fat raw"),
        (Rx(@"\b(italian|seasoned)\s+(bread\s*crumbs|breadcrumbs)\b"), "bread crumbs dry grated seasoned"),
        (Rx(@"\b(panko|bread\s*crumbs|breadcrumbs)\b"), "bread crumbs dry grated plain"),
        (Rx(@"\b(marinara|pasta sauce|spaghetti sauce|tomato basil sauce|arrabbiata)\b"), "spaghetti sauce"),
        (Rx(@"\b(pork shoulder|pork butt|boston butt)\b"), "pork fresh shoulder whole separable lean and fat raw"),
        (Rx(@"\bcumin\b"), "spices cumin seed"),
        (Rx(@"\b(italian seasoning|herbes de provence|mixed herbs)\b"), "spices oregano dried"), // stand-in: dried herbs, ~3 kcal/tsp
        (Rx(@"\b(kosher|sea|flaky|coarse|fine)\s+salt\b"), "salt table"),
        (Rx(@"\b(extra[- ]virgin olive oil|olive oil|evoo)\b"), "oil olive salad or cooking"),
        (Rx(@"\b(vegetable oil|canola oil|neutral oil)\b"), "oil canola"),
        (Rx(@"\b(chicken (broth|stock))\b"), "soup chicken broth ready-to-serve"),
        (Rx(@"\bheavy (whipping )?cream\b"), "cream fluid heavy whipping"),
        (Rx(@"\bunsalted butter\b"), "butter without salt"),
        (Rx(@"\b(cooked|leftover)\s+(spaghetti|linguine|fettuccine|penne|rigatoni|macaroni|rotini|fusilli|farfalle|pasta|noodles)\b"), "pasta cooked enriched without added salt"),
        (Rx(@"\b(spaghetti|linguine|fettuccine|fettucine|penne|rigatoni|ziti|elbow macaroni|macaroni|rotini|fusilli|farfalle|bucatini|angel hair|orzo|pasta)\b(?!\s*(sauce|squash))"), "pasta dry enriched"),
    ];

    /// <summary>Recipe wording → USDA wording, or null when no alias applies.</summary>
    public static string? Alias(string foodText)
    {
        var text = foodText.ToLowerInvariant();
        foreach (var (pattern, query) in Aliases)
        {
            var m = pattern.Match(text);
            if (!m.Success) continue;
            if (query == "{beef}")
            {
                var lean = m.Groups[1].Success ? m.Groups[1].Value : m.Groups[3].Value;
                var fat = m.Groups[2].Success ? m.Groups[2].Value : m.Groups[4].Value;
                return $"beef ground {lean} lean meat {fat} fat raw";
            }
            if (query == "{beefpct}")
            {
                var lean = int.Parse(m.Groups[1].Value);
                return $"beef ground {lean} lean meat {100 - lean} fat raw";
            }
            return query;
        }
        return null;
    }

    private static Regex Rx(string pattern) => new(pattern, RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    public static string Clean(string foodText)
    {
        if (Alias(foodText) is { } alias) return alias;
        // Brand possessives aren't in USDA names: "Rao's Homemade marinara" → "marinara", "Trader Joe's …".
        foodText = BrandPossessive().Replace(foodText, " ");
        var words = WordSplit().Split(foodText).Where(w => w.Length > 0 && !Noise.Contains(w)).ToList();
        var cleaned = string.Join(' ', words).Trim();
        return cleaned.Length >= 2 ? cleaned : foodText;
    }

    [GeneratedRegex(@"[\s,;]+")]
    private static partial Regex WordSplit();

    [GeneratedRegex(@"\b[A-Z][\w&]*'s(\s+(Homemade|Kitchen|Brand|Organic|Classic))?\b")]
    private static partial Regex BrandPossessive();
}
