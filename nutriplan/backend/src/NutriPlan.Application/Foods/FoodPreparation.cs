namespace NutriPlan.Application.Foods;

public enum PreparationState { Unspecified, Raw, Cooked }

/// <summary>
/// Raw vs cooked, worked out from names and wording only (never by converting weights). USDA names carry the state
/// ("Rice, white, long-grain, regular, raw" / "…, cooked"); people say it in words ("grilled chicken", "dry pasta").
/// Raw and cooked weights are very different foods nutritionally, so the state is kept, matched and shown.
/// </summary>
public static class FoodPreparation
{
    private static readonly HashSet<string> RawWords = ["raw", "uncooked"];

    private static readonly HashSet<string> CookedWords =
    [
        "cooked", "roasted", "grilled", "fried", "baked", "boiled", "steamed", "broiled", "braised", "stewed",
        "sauteed", "poached", "scrambled", "toasted", "microwaved", "pan-fried", "stir-fried", "rotisserie", "prepared",
    ];

    /// <summary>Foods people almost always eat cooked while USDA's plain entry is the dry/raw ingredient.</summary>
    private static readonly HashSet<string> CookedStaples =
    [
        "rice", "pasta", "spaghetti", "noodle", "macaroni", "quinoa", "couscous", "bulgur", "barley", "lentil", "bean",
        "chickpea", "farro", "penne", "linguine", "fettuccine", "ramen",
    ];

    /// <summary>
    /// Foods where raw vs cooked is a real question for a log (meat, fish, grains, pasta, legumes, potatoes). For a banana or an
    /// apple "raw" is just what it is, so no raw/cooked prompt is shown.
    /// </summary>
    private static readonly HashSet<string> CookingMatters =
    [
        "chicken", "turkey", "duck", "beef", "steak", "pork", "lamb", "veal", "bison", "venison", "fish", "salmon", "tuna", "cod",
        "tilapia", "trout", "halibut", "shrimp", "scallop", "crab", "lobster", "sausage", "bacon", "ham",
        "rice", "pasta", "spaghetti", "noodle", "macaroni", "quinoa", "couscous", "bulgur", "barley", "lentil", "bean", "chickpea",
        "farro", "penne", "linguine", "fettuccine", "ramen", "potato", "oat", "oatmeal",
    ];

    public static bool CookingMattersFor(string foodName) => FoodRanker.Tokens(foodName).Any(CookingMatters.Contains);

    private static readonly HashSet<string> Noise =
    [
        "raw", "uncooked", "cooked", "dry", "with", "without", "salt", "added", "enriched", "unenriched", "regular", "nfs", "ns", "as", "to", "fat",
        "drained", "solids", "and", "liquids", "boiled", "steamed", "roasted", "baked", "fried", "grilled", "braised", "stewed", "prepared",
    ];

    public static bool IsRawWord(string token) => RawWords.Contains(token);
    public static bool IsCookedWord(string token) => CookedWords.Contains(token);

    /// <summary>The state a person asked for, from stemmed query tokens; Unspecified if they didn't say.</summary>
    public static PreparationState Requested(IEnumerable<string> queryTokens)
    {
        var tokens = queryTokens.ToList();
        if (tokens.Any(CookedWords.Contains)) return PreparationState.Cooked;
        if (tokens.Any(RawWords.Contains) || (tokens.Contains("dry") && tokens.Any(CookedStaples.Contains))) return PreparationState.Raw;
        return PreparationState.Unspecified;
    }

    /// <summary>The state of a USDA food from its name. "Dry" counts as raw only for staples (dry pasta), not "dry milk".</summary>
    public static PreparationState StateOf(string foodName)
    {
        var tokens = FoodRanker.Tokens(foodName).ToList();
        var staple = tokens.Any(CookedStaples.Contains);
        if (tokens.Any(CookedWords.Contains)) return PreparationState.Cooked;
        if (tokens.Any(RawWords.Contains) || (staple && tokens.Contains("dry"))) return PreparationState.Raw;
        return PreparationState.Unspecified;
    }

    /// <summary>Plain cooked/boiled/steamed (what "a cup of rice" means), as opposed to a method or dish like "fried rice".</summary>
    public static bool IsPlainCooked(string foodName)
    {
        var tokens = FoodRanker.Tokens(foodName).ToList();
        return tokens.Any(t => t is "cooked" or "boiled" or "steamed") && !tokens.Any(t => t is "fried" or "roasted" or "baked" or "grilled" or "stir-fried" or "pan-fried");
    }

    public static bool IsCookedStaple(IEnumerable<string> queryTokens) => queryTokens.Any(CookedStaples.Contains);

    /// <summary>The name without its state and filler words, to find the raw/cooked counterpart of the same food.</summary>
    public static HashSet<string> Identity(string foodName) => FoodRanker.Tokens(foodName).Where(t => !Noise.Contains(t)).ToHashSet();

    public static double Similarity(HashSet<string> a, HashSet<string> b)
    {
        if (a.Count == 0 || b.Count == 0) return 0;
        return (double)a.Intersect(b).Count() / a.Union(b).Count();
    }
}
