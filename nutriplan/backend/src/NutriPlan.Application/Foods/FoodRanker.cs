using System.Text.RegularExpressions;
using NutriPlan.Application.Abstractions;
using NutriPlan.Domain.Foods;
using NutriPlan.Domain.Units;

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
        "sauteed", "poached", "scrambled", "toasted", "smoked", "microwaved", "pan-fried", "stir-fried", "rotisserie",
    ];

    /// <summary>USDA puts a category first ("Nuts, almonds", "Fish, salmon, ..."): the real food is the next segment.</summary>
    private static readonly HashSet<string> CategoryPrefixes =
    [
        "nuts", "seeds", "fish", "spices", "beverages", "cereals", "cereals ready-to-eat", "beef", "pork", "lamb", "veal",
        "game meat", "crustaceans", "mollusks", "candies", "snacks", "alcoholic beverage", "fast foods", "restaurant", "babyfood",
    ];

    /// <summary>Words that name a prepared form of a food (stemmed, as <see cref="Tokens"/> produces them).</summary>
    private static readonly HashSet<string> FormWords =
    [
        "chip", "soup", "juice", "smoothie", "sauce", "salad", "sandwich", "pie", "muffin", "cookie", "cake", "cracker",
        "fry", "frie", "nugget", "bar", "cereal", "pancake", "waffle", "burrito", "taco", "pizza", "stew", "curry", "jerky",
        "chowder", "dip", "spread", "milkshake", "shake", "latte", "brownie", "granola", "pudding", "casserole",
    ];

    /// <summary>Descriptors USDA uses for the plain, default form of a food.</summary>
    private static readonly HashSet<string> DefaultDescriptors = ["whole", "plain", "fresh", "regular", "long-grain", "all commercial varieties", "nfs"];

    /// <summary>Signals a processed/derived product rather than the food itself.</summary>
    /// <summary>Organ meats and by-products: never what a plain "chicken" or "beef" means, so a strong penalty unless asked for.</summary>
    private static readonly HashSet<string> OrganWords = ["giblet", "giblets", "foot", "gizzard", "gizzards", "liver", "livers", "heart", "hearts", "neck", "necks", "feet", "tongue", "kidney", "kidneys", "tripe", "brain", "brains"];

    private static readonly HashSet<string> ProcessedWords =
    [
        "breaded", "nugget", "tender", "ground", "topping", "roll", "patty", "patties", "stick", "imitation", "babyfood", "canned", "dried",
        "powder", "dehydrated", "frozen", "heated", "mix", "substitute", "flavored", "sweetened", "bar",
    ];

    /// <param name="useHistory">Boost foods you log often. On for search (your usual yogurt first); off for recipe
    /// matching, where "whole milk" must match milk even if you log yogurt every day.</param>
    /// <param name="assumeCookedStaples">Rice, pasta, beans… with no state said: prefer the cooked entry (what people eat) instead of
    /// the dry ingredient. Off for recipe ingredients, where "1 cup rice" means dry.</param>
    public static IReadOnlyList<RankedFood> Rank(string query, IEnumerable<FoodSearchRow> rows, bool useHistory = true, bool assumeCookedStaples = false)
    {
        var queryTokens = Tokens(query).ToList();
        var requested = FoodPreparation.Requested(queryTokens);
        var cookedDefault = assumeCookedStaples && requested == PreparationState.Unspecified && FoodPreparation.IsCookedStaple(queryTokens);
        var wantsCombination = CombinationDish().IsMatch($" {query.ToLowerInvariant()} "); // "mac and cheese", "rice with beans"
        return rows
            .Select(r => new RankedFood(r.Food, Score(queryTokens, requested, cookedDefault, r, useHistory, wantsCombination)))
            .OrderByDescending(r => r.Score)
            .ThenBy(r => r.Food.Name.Length)
            .ToList();
    }

    private static double Score(List<string> queryTokens, PreparationState requested, bool cookedDefault, FoodSearchRow row, bool useHistory, bool wantsCombination)
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

            // Position: query words near the start ("Chicken, breast, ...", "Nuts, almonds") are a strong signal.
            var leading = headTokens.Concat(Tokens(segments.Length > 1 ? segments[1] : "")).ToHashSet();
            score += 10.0 * queryTokens.Count(leading.Contains) / queryTokens.Count;

            // "Almond butter", "Oat milk", "Salmon nuggets": the query word only modifies a different food.
            var lastMatch = headTokens.FindLastIndex(querySet.Contains);
            if (lastMatch >= 0 && headTokens.Skip(lastMatch + 1).Any(t => !querySet.Contains(t)))
                score -= 8;

            // "Yogurt, whole milk" for "whole milk", "Mayonnaise, with olive oil" for "olive oil": the query words are
            // only details of a different food. (Foods named by their category, like "Cheese, parmesan", are hit
            // equally, so they still rank among themselves.)
            if (!headTokens.Any(querySet.Contains))
                score -= 6;
            // USDA names lead with the food itself ("Pizza, cheese"): a name that starts with a search word is that food,
            // unlike "Topping from cheese pizza" or "Dessert pizza".
            else if (headTokens.Count > 0 && querySet.Contains(headTokens[0]))
                score += 8;

            // "Beans and brown rice", "Chicken with rice" for "brown rice": a combination dish you didn't ask for.
            if (!wantsCombination && CombinationDish().IsMatch(head))
                score -= 8;

            // "kale chips", "tomato soup", "apple juice": the form is the food. A match that lacks it (raw kale) is a
            // different food, so it ranks lower and shows as a weak match instead of a confident one.
            score -= 15 * queryTokens.Count(q => FormWords.Contains(q) && !nameTokens.Contains(q));
        }

        // Plain default forms ("Egg, whole", "Yogurt, plain") over variants, unless the query asks otherwise.
        score += 3 * Math.Min(2, DefaultDescriptors.Count(d => segments.Contains(d) || nameTokens.Contains(d)));
        score -= 4 * nameTokens.Count(t => ProcessedWords.Contains(t) && !querySet.Contains(t));
        score -= 14 * nameTokens.Count(t => OrganWords.Contains(t) && !querySet.Contains(t));

        // Plain is better: penalise extra words that weren't asked for.
        var extra = Math.Max(0, nameTokens.Count - queryTokens.Count);
        score -= Math.Min(15, extra * 1.2);

        // Raw vs cooked. A state the person asked for is matched strictly; otherwise raw is the default for produce and
        // meat, and cooked for staples people eat cooked (rice, pasta, beans) — shown as an assumption, never silent.
        var state = FoodPreparation.StateOf(food.Name);
        score += requested switch
        {
            PreparationState.Cooked => state == PreparationState.Cooked ? 10 : state == PreparationState.Raw ? -14 : 0,
            PreparationState.Raw => state == PreparationState.Raw ? 10 : state == PreparationState.Cooked ? -14 : 0,
            _ when cookedDefault => state == PreparationState.Cooked ? (FoodPreparation.IsPlainCooked(food.Name) ? 10 : 2) : state == PreparationState.Raw ? -10 : 0,
            _ => state == PreparationState.Raw ? 4 : state == PreparationState.Cooked ? -2 : 0,
        };

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

        // A food you can log in items or cups (from its own USDA measures) is a little easier to use than one that only
        // takes grams. Small on purpose: it only separates otherwise-equal matches, never state, wording or history.
        if (HasMeasuredPortion(food)) score += MeasuredPortionBoost;

        // Personal history.
        if (useHistory) score += Math.Min(20, Math.Log2(1 + row.TimesLogged) * 5);

        // Database similarity as a tie-breaker.
        score += row.TextSimilarity * 5;

        return score;
    }

    public const double MeasuredPortionBoost = 2;

    /// <summary>The food has a count or household-volume measure that comes from its data (not just g/oz or a drink's ml).</summary>
    public static bool HasMeasuredPortion(Food food) =>
        food.Portions.Count > 0 && FoodMeasures.For(food).Any(m => m.Kind != MeasureKind.Mass && m.Source is not null);

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

    [System.Text.RegularExpressions.GeneratedRegex(@"\s(and|with)\s")]
    private static partial System.Text.RegularExpressions.Regex CombinationDish();
}
