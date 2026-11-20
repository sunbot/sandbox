using System.Text.RegularExpressions;
using NutriPlan.Application.Abstractions;
using NutriPlan.Domain.Foods;

namespace NutriPlan.Application.Foods;

public sealed record RankedFood(Food Food, double Score);

/// <summary>
/// Orders text-search hits the way a person would. USDA names read like
/// "Chicken, broilers or fryers, breast, meat only, raw", so plain similarity isn't enough:
///   • every query word should appear (stemmed),
///   • earlier name segments matter more ("Chicken, ..." for "chicken"),
///   • trusted sources beat crowd data, foods you log often float up,
///   • shorter, plainer names beat long specific ones,
///   • unless the query says "cooked"/"fried"/etc., prefer raw (that's how packages and scales report it).
/// </summary>
public static partial class FoodRanker
{
    private static readonly HashSet<string> StopWords = ["of", "and", "the", "a", "an", "with", "in", "for", "or"];

    private static readonly HashSet<string> CookingWords =
    [
        "cooked", "roasted", "grilled", "fried", "baked", "boiled", "steamed", "broiled", "braised", "stewed",
        "sauteed", "poached", "scrambled", "toasted", "smoked", "microwaved", "pan-fried", "stir-fried",
    ];

    /// <summary>USDA puts a category first ("Nuts, almonds", "Fish, salmon, ..."): the real food is the next segment.</summary>
    private static readonly HashSet<string> CategoryPrefixes =
    [
        "nuts", "seeds", "fish", "spices", "beverages", "cereals", "cereals ready-to-eat", "beef", "pork", "lamb", "veal",
        "game meat", "crustaceans", "mollusks", "candies", "snacks", "alcoholic beverage", "fast foods", "restaurant", "babyfood",
    ];

    /// <summary>Descriptors USDA uses for the plain, default form of a food.</summary>
    private static readonly HashSet<string> DefaultDescriptors = ["whole", "plain", "fresh", "regular", "long-grain", "all commercial varieties", "nfs"];

    /// <summary>Signals a processed/derived product rather than the food itself.</summary>
    private static readonly HashSet<string> ProcessedWords =
    [
        "breaded", "nugget", "tender", "roll", "patty", "patties", "stick", "imitation", "babyfood", "canned", "dried",
        "powder", "dehydrated", "frozen", "heated", "mix", "substitute", "flavored", "sweetened", "bar",
    ];

    public static IReadOnlyList<RankedFood> Rank(string query, IEnumerable<FoodSearchRow> rows)
    {
        var queryTokens = Tokens(query).ToList();
        var wantsCooked = queryTokens.Any(CookingWords.Contains);
        return rows
            .Select(r => new RankedFood(r.Food, Score(queryTokens, wantsCooked, r)))
            .OrderByDescending(r => r.Score)
            .ThenBy(r => r.Food.Name.Length)
            .ToList();
    }

    private static double Score(List<string> queryTokens, bool wantsCooked, FoodSearchRow row)
    {
        var food = row.Food;
        var segments = food.Name.ToLowerInvariant().Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);
        var nameTokens = Tokens(food.Name).ToList();
        var brandTokens = food.Brand is null ? [] : Tokens(food.Brand).ToList();

        double score = 0;
        var querySet = queryTokens.ToHashSet();

        // The "head" segment names the food itself: skip a leading category ("Nuts, almonds").
        var head = segments.Length > 1 && CategoryPrefixes.Contains(segments[0]) ? segments[1] : segments.FirstOrDefault() ?? "";
        var headTokens = Tokens(head).ToList();

        // Coverage: share of query words found in the name (or brand).
        if (queryTokens.Count > 0)
        {
            var found = queryTokens.Count(q => nameTokens.Contains(q) || brandTokens.Contains(q) || nameTokens.Any(n => n.StartsWith(q) && q.Length >= 4));
            score += 40.0 * found / queryTokens.Count;
            if (found == queryTokens.Count) score += 15;

            // Position: a query word in the head segment ("Chicken, ...", "Nuts, almonds") is a strong signal.
            score += 10.0 * queryTokens.Count(headTokens.Contains) / queryTokens.Count;

            // "Almond butter", "Oat milk", "Salmon nuggets": the query word only modifies a different food.
            var lastMatch = headTokens.FindLastIndex(querySet.Contains);
            if (lastMatch >= 0 && headTokens.Skip(lastMatch + 1).Any(t => !querySet.Contains(t)))
                score -= 8;
        }

        // Plain default forms ("Egg, whole", "Yogurt, plain") over variants, unless the query asks otherwise.
        score += 3 * Math.Min(2, DefaultDescriptors.Count(d => segments.Contains(d) || nameTokens.Contains(d)));
        score -= 4 * nameTokens.Count(t => ProcessedWords.Contains(t) && !querySet.Contains(t));

        // Plain is better: penalise extra words that weren't asked for.
        var extra = Math.Max(0, nameTokens.Count - queryTokens.Count);
        score -= Math.Min(15, extra * 1.2);

        // Raw vs cooked.
        var isCooked = nameTokens.Any(CookingWords.Contains);
        var isRaw = nameTokens.Contains("raw");
        if (wantsCooked) score += isCooked ? 6 : isRaw ? -6 : 0;
        else score += isRaw ? 4 : isCooked ? -2 : 0;

        // Source trust.
        score += food.Source switch
        {
            FoodSource.User => 10,
            FoodSource.Recipe => 8,
            FoodSource.UsdaFoundation => 7,
            FoodSource.UsdaSrLegacy => 6,
            FoodSource.UsdaSurvey => 6,     // "as eaten" foods with everyday names ("Milk, whole", "Coffee, brewed")
            FoodSource.UsdaBranded => 1,
            _ => 0,
        };
        score += food.Quality switch
        {
            DataQuality.Verified => 3,
            DataQuality.Flagged => -12,
            _ => 0,
        };

        // Personal history.
        score += Math.Min(20, Math.Log2(1 + row.TimesLogged) * 5);

        // Database similarity as a tie-breaker.
        score += row.TextSimilarity * 5;

        return score;
    }

    public static IEnumerable<string> Tokens(string text) =>
        TokenSplit().Split(text.ToLowerInvariant())
            .Where(t => t.Length > 1 && !StopWords.Contains(t))
            .Select(Stem);

    /// <summary>Very small English stemmer: just enough to match "eggs"→"egg", "berries"→"berry".</summary>
    public static string Stem(string word) =>
        word.Length <= 3 ? word :
        word.EndsWith("ies") ? word[..^3] + "y" :
        word.EndsWith("oes") ? word[..^2] :
        word.EndsWith("ches") || word.EndsWith("shes") ? word[..^2] :
        word.EndsWith('s') && !word.EndsWith("ss") && !word.EndsWith("us") ? word[..^1] :
        word;

    [GeneratedRegex(@"[^a-z0-9%\-]+")]
    private static partial Regex TokenSplit();
}
