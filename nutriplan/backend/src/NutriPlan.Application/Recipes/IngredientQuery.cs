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
        (Rx(@"\bvanilla( extract| essence)?\b(?! (yogurt|ice cream|soymilk|milk))"), "vanilla extract"),
        (Rx(@"\b(kombu|kelp)\b"), "seaweed kelp raw"),
        (Rx(@"\b(frozen |green |sweet |garden )?peas\b(?! *(pods?|shoots))(?<!snow peas)(?<!snap peas)(?<!chick ?peas)(?<!black[- ]eyed peas)"), "peas green frozen unprepared"),
        (Rx(@"\b(cooked|steamed|leftover)\s+brown rice\b"), "rice brown cooked no added fat"),
        (Rx(@"\b(cooked|steamed|leftover)\b[\w\s]*?\brice\b(?! (vinegar|wine|noodles|paper|flour))"), "rice white cooked no added fat"),
        (Rx(@"\bsalmon( fill?ets?| fillet| steaks?| sides?)?\b(?! *(smoked|lox|canned))"), "fish salmon atlantic farmed raw"),
        (Rx(@"\b(fresh )?dill( weed)?\b(?! pickles?)"), "dill weed fresh"),
        (Rx(@"\bturkey bacon\b"), "bacon turkey unprepared"),
        (Rx(@"\bbacon\b"), "pork cured bacon unprepared"),
        (Rx(@"\bsmoked turkey\b"), "turkey light or dark meat smoked skin eaten"),
        (Rx(@"\bwhole chickens?\b"), "chicken broilers or fryers meat and skin raw"),
        (Rx(@"^pepper$"), "spices pepper black"),
        (Rx(@"\b(garlic cloves?|cloves? (of )?garlic|garlic)\b(?!\s*(powder|salt|cubes?))"), "garlic raw"),
        (Rx(@"\bcelery (ribs?|stalks?|sticks?)\b|\bcelery\b"), "celery raw"),
        (Rx(@"\b(dark|light|packed)?\s*brown sugar\b"), "sugars brown"),
        (Rx(@"\b(semi-?sweet|bittersweet|dark|milk)?\s*chocolate chips\b"), "chocolate chips"),
        (Rx(@"\b(semi-?sweet|bittersweet) chocolate\b"), "candies semisweet chocolate"),
        (Rx(@"\b(dutch[- ]process(ed)?|unsweetened)?\s*cocoa( powder)?\b"), "cocoa dry powder unsweetened"),
        (Rx(@"\ball[- ]purpose flour\b|\bap flour\b|^flour$"), "flour wheat all-purpose enriched bleached"),
        (Rx(@"\b(crushed red pepper|red[- ]pepper flakes|chili flakes|gochugaru|korean (hot |red )?pepper (flakes|powder))\b"), "spices pepper red or cayenne"), // stand-in for gochugaru
        (Rx(@"\bcayenne\b"), "spices pepper red or cayenne"),
        (Rx(@"\b(smoked|sweet|hungarian|spanish)?\s*paprika\b"), "spices paprika"),
        (Rx(@"\b(white pepper|ground white pepper)\b"), "spices pepper white"),
        (Rx(@"\b(black pepper|peppercorns?|cracked pepper|ground pepper)\b"), "spices pepper black"),
        (Rx(@"\b(ancho |chipotle )?chili powder\b"), "spices chili powder"),
        (Rx(@"\b(dry|dried|ground) mustard\b|\bmustard (powder|seeds?)\b"), "spices mustard seed ground"),
        (Rx(@"\b(dijon|yellow|whole[- ]grain|stone[- ]ground|brown)?\s*mustard\b(?!\s*greens)"), "mustard prepared yellow"),
        (Rx(@"\b(lemon|lime|orange) (zest|peel)\b|\bzest of\b"), "lemon peel raw"),
        (Rx(@"\b(ground|powdered) ginger\b"), "spices ginger ground"),
        (Rx(@"\b(fresh )?ginger( root)?\b|\bginger cubes?\b"), "ginger root raw"),
        (Rx(@"\b(toasted )?sesame oil\b"), "oil sesame salad or cooking"),
        (Rx(@"\b(rice|white|distilled|wine|red wine|white wine|sherry)? ?vinegar\b"), "vinegar"),
        (Rx(@"\b(apple )?cider vinegar\b"), "vinegar cider"),
        (Rx(@"\bbalsamic\b"), "vinegar balsamic"),
        (Rx(@"\b(white |yellow |red )?miso( paste)?\b"), "miso"),
        (Rx(@"\b(green onions?|scallions?|spring onions?)\b"), "onions spring or scallions raw"),
        (Rx(@"\b(reduced[- ]sodium|low[- ]sodium|lite) soy sauce\b"), "soy sauce reduced sodium"),
        (Rx(@"\b(soy sauce|shoyu|tamari)\b"), "soy sauce"),
        (Rx(@"\b(bouillon cubes?|bouillon|stock cubes?|better than bouillon)\b"), "soup chicken broth or bouillon dry"),
        (Rx(@"\b(chicken|vegetable|veggie|turkey)( or (chicken|vegetable|veggie))? (broth|stock)\b|^(broth|stock)$"), "soup chicken broth ready-to-serve"),
        (Rx(@"\bbeef (broth|stock)\b"), "soup beef broth ready-to-serve"),
        (Rx(@"\bcinnamon( sticks?)?\b"), "spices cinnamon ground"),
        (Rx(@"\b(whole |ground )?cloves\b"), "spices cloves ground"),
        (Rx(@"\bcardamom( pods)?\b"), "spices cardamom"),
        (Rx(@"\bbay leaf|bay leaves\b"), "spices bay leaf"),
        (Rx(@"(?<!nutritional )\b(instant|active dry|rapid[- ]rise)? ?yeast\b"), "leavening agents yeast baker's active dry"),
        (Rx(@"\b(nonfat )?dry milk( powder)?\b|\bmilk powder\b"), "milk dry nonfat regular"),
        (Rx(@"\b(english |persian |hothouse )?cucumbers?\b"), "cucumber with peel raw"),
        (Rx(@"\b(shaoxing|rice) wine\b|\bmirin\b|\bsake\b"), "alcoholic beverage rice sake"),
        (Rx(@"\bkimchi\b(?! juice)"), "kimchi"),
        (Rx(@"\bkalamata olives?\b|\bolives?\b"), "olives"),
        (Rx(@"\broasted red peppers?\b"), "peppers sweet red canned solids and liquids"),
        (Rx(@"\brice (stick )?noodles\b|\bvermicelli\b"), "rice noodles dry"),
        (Rx(@"\bpita( breads?)?\b"), "bread pita"),
        (Rx(@"\bsourdough( bread| loaf)?\b|\bfrench bread\b|\bbaguette\b|\bciabatta\b"), "bread french or vienna"),
        (Rx(@"\bcollard( greens)?\b"), "collards raw"),
        (Rx(@"\b(firm |extra[- ]firm |silken |soft )?tofu\b"), "tofu raw regular prepared with calcium sulfate"),
        (Rx(@"\b(cooked|leftover)\s+(spaghetti|linguine|fettuccine|penne|rigatoni|macaroni|rotini|fusilli|farfalle|pasta|noodles)\b"), "pasta cooked enriched without added salt"),
        (Rx(@"\b(spaghetti|linguine|fettuccine|fettucine|penne|rigatoni|ziti|elbow macaroni|macaroni|rotini|fusilli|farfalle|bucatini|angel hair|orzo|pasta)\b(?!\s*(sauce|squash))"), "pasta dry enriched"),
    ];

    /// <summary>
    /// A line without an amount that isn't a real portion: seasoning to taste, garnish, "for serving", oil for the pan.
    /// These are left out of the totals instead of being flagged as problems.
    /// </summary>
    public static bool IsMinorWithoutAmount(string rawText, string foodText) =>
        MinorPhrase().IsMatch(rawText) || MinorFood().IsMatch(foodText.Trim());

    [GeneratedRegex(@"\b(for (serving|garnish|topping|dredging|dusting|the pan|frying|greasing|brushing|drizzling|sprinkling)|to taste|as needed|optional|to cover|if desired|wedges)\b", RegexOptions.IgnoreCase)]
    private static partial Regex MinorPhrase();

    [GeneratedRegex(@"^((kosher|sea|flaky|table|coarse|fine)?\s*salt( and( freshly)?( ground| cracked)?( black)? pepper)?|(freshly )?(ground |cracked )?(black )?pepper|water|ice|cooking spray|nonstick spray)$", RegexOptions.IgnoreCase)]
    private static partial Regex MinorFood();

    /// <summary>Shorter searches for a query that found nothing confident: the last two words, then the last word.</summary>
    public static IEnumerable<string> ShorterQueries(string query)
    {
        var words = WordSplit().Split(query.Trim()).Where(w => w.Length > 0).ToList();
        if (words.Count >= 3) yield return string.Join(' ', words.TakeLast(2));
        if (words.Count >= 2 && words[^1].Length >= 4 && !GenericLastWords.Contains(words[^1])) yield return words[^1];
    }

    /// <summary>Last words that don't name a food by themselves ("rice vinegar" → "vinegar" is fine; "pepper flakes" → "flakes" isn't).</summary>
    private static readonly HashSet<string> GenericLastWords = new(StringComparer.OrdinalIgnoreCase)
    {
        "flakes", "paste", "powder", "sauce", "leaves", "juice", "seeds", "cubes", "mix", "chips", "pieces", "sticks", "slices",
        "strips", "wedges", "blend", "seasoning", "spread", "dressing", "stock", "broth", "water", "meat", "bread",
    };

    /// <summary>True when the USDA name's leading words are the searched noun ("Sugars, brown" for "brown sugar").</summary>
    public static bool NamesTheFood(string foodName, string query)
    {
        var lead = string.Join(' ', foodName.ToLowerInvariant().Split(',').Take(2));
        return WordSplit().Split(query.ToLowerInvariant()).Where(w => w.Length > 2)
            .All(w => lead.Contains(w.TrimEnd('s')));
    }

    /// <summary>Lines that are never a separate ingredient: reserved liquids and drippings, citrus used only for its zest.</summary>
    public static bool IsNeverCounted(string rawText) => NeverCounted().IsMatch(rawText);

    [GeneratedRegex(@"\b(reserved|pan juices|resting juices|drippings|pasta water|cooking liquid|zested(?! and juiced)|for the pan)\b", RegexOptions.IgnoreCase)]
    private static partial Regex NeverCounted();

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
