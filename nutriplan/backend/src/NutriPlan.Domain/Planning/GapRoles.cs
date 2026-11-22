using System.Text.RegularExpressions;

namespace NutriPlan.Domain.Planning;

/// <summary>
/// What a food or recipe is in a day of eating (a main, a side, a ready-to-eat snack, a prepared dish, or just an
/// ingredient). This is what lets the recommender assemble meals that make sense instead of arbitrary nutrient piles.
/// It's a transparent, tested rule table over the food's name and USDA category: no AI, and no nutrition numbers are
/// involved. USDA names read "Food, modifiers" ("Tuna, light, canned in water"), so ingredient words are only looked for
/// in the food's own name (the part before the first comma), never in its modifiers or category.
/// </summary>
public static partial class GapRoles
{
    private static Regex Rx(string p) => new(p, RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Compiled);

    // Foods that are things you cook or season with, or drink, rather than eat as a food. Matched on the food's own name.
    private static readonly Regex IngredientHead = Rx(@"\b(oils?|shortening|lard|margarine|butter(?!\s+beans?)|sugars?(?!\s+snap)|syrups?|honey|jam|jelly|flour|starch|salt|spices?|seasonings?|herbs?|vinegar|extract|baking|yeast|gelatin|sauces?|dressings?|ketchup|mustard|mayonnaise|salsa|coffee|tea|water|broth|bouillon|stock|powder|supplements?|cocoa|flavou?rings?|juices?|soda|beverages?|drinks?|candy|candies|frosting|gravy|marinade)\b");
    private static readonly Regex IngredientCategory = Rx(@"\b(fats and oils|spices and herbs|beverages|sweets|baking)\b");

    // A prepared dish: sized by its calories, not assembled from parts.
    private static readonly Regex MixedHead = Rx(@"\b(soups?|stews?|chili|casseroles?|lasagna|pizza|sandwich(es)?|burgers?|burritos?|tacos?|wraps?|pot pie|pies?|macaroni|stir.?fry|curry|salads?|bowls?)\b");

    private static readonly Regex NutButter = Rx(@"\b(peanut|almond|cashew|nut|sunflower seed) butter\b");

    // By the food's name. Order matters: the first match wins.
    private static readonly (Regex Pattern, FoodGroup Group)[] NameRules =
    [
        (Rx(@"\beggs?\b"), FoodGroup.Egg),
        (Rx(@"\b(yogurt|yoghurt|cottage cheese|cheese|milk|kefir|skyr)\b"), FoodGroup.Dairy),
        (Rx(@"\b(chicken|turkey|beef|steak|pork|ham|lamb|veal|fish|salmon|tuna|cod|tilapia|trout|halibut|sardines?|shrimp|tofu|tempeh)\b"), FoodGroup.Protein),
        (Rx(@"\b(green beans|string beans|snap beans?|beans?, snap|sugar snap|snap peas?|snow peas?)\b"), FoodGroup.Vegetable),
        (Rx(@"\b(beans?|lentils?|chickpeas?|peas|hummus|edamame)\b"), FoodGroup.Legume),
        (Rx(@"\b(almonds?|walnuts?|pecans?|cashews?|pistachios?|peanuts?|hazelnuts?|seeds?|nuts|trail mix)\b"), FoodGroup.NutsSeeds),
        (Rx(@"\b(apples?|bananas?|berry|berries|oranges?|grapes?|melon|watermelon|pears?|peach(es)?|plums?|mango(es)?|pineapple|cherr(y|ies)|kiwi|fruit|avocados?|apricots?|nectarines?|papaya|tangerines?|clementines?|grapefruit)\b"), FoodGroup.Fruit),
        (Rx(@"\b(broccoli|spinach|kale|carrots?|peppers?|tomato(es)?|cucumbers?|lettuce|zucchini|squash|cauliflower|cabbage|asparagus|celery|mushrooms?|onions?|beets?|brussels|vegetables?|eggplant|greens)\b"), FoodGroup.Vegetable),
        (Rx(@"\b(oats?|oatmeal|cereals?|granola|bagels?|crackers?|buns?|muffins?|bread|toast|tortillas?)\b"), FoodGroup.Cereal),
        (Rx(@"\b(rice|pasta|spaghetti|noodles?|quinoa|potatoes|potato|couscous|barley|bulgur|polenta)\b"), FoodGroup.Grain),
    ];

    // Only when the name says nothing: the USDA category.
    private static readonly (Regex Pattern, FoodGroup Group)[] CategoryRules =
    [
        (Rx(@"\bfruits?\b"), FoodGroup.Fruit),
        (Rx(@"\bvegetables?\b"), FoodGroup.Vegetable),
        (Rx(@"\blegumes?\b"), FoodGroup.Legume),
        (Rx(@"\b(poultry|beef|pork|finfish|shellfish|lamb|veal)\b"), FoodGroup.Protein),
        (Rx(@"\bnut and seed\b"), FoodGroup.NutsSeeds),
        (Rx(@"\bdairy\b"), FoodGroup.Dairy),
    ];

    private static (FoodGroup Group, bool Ingredient, bool Matched) Match(string name, string? category)
    {
        var full = name.ToLowerInvariant();
        var head = full.Split(',')[0].Trim();
        var cat = (category ?? "").ToLowerInvariant();

        if (NutButter.IsMatch(full)) return (FoodGroup.NutsSeeds, false, true);
        if (IngredientHead.IsMatch(head) || IngredientCategory.IsMatch(cat)) return (FoodGroup.Other, true, true);
        if (MixedHead.IsMatch(head)) return (FoodGroup.Mixed, false, true);
        foreach (var (pattern, group) in NameRules)
            if (pattern.IsMatch(full)) return (group, false, true);
        foreach (var (pattern, group) in CategoryRules)
            if (pattern.IsMatch(cat)) return (group, false, true);
        return (FoodGroup.Other, true, false);
    }

    /// <summary>True when a rule matched (even an ingredient rule); false for a food the table knows nothing about.</summary>
    public static bool Recognized(string name, string? category) => Match(name, category).Matched;

    public static (FoodGroup Group, GapRole Role) ClassifyFood(string name, string? category)
    {
        var (group, ingredient, _) = Match(name, category);
        return (group, ingredient ? GapRole.Ingredient : RoleOf(group));
    }

    public static GapRole RoleOf(FoodGroup group) => group switch
    {
        FoodGroup.Egg or FoodGroup.Dairy or FoodGroup.Fruit or FoodGroup.NutsSeeds or FoodGroup.Cereal or FoodGroup.Mixed => GapRole.Snack,
        FoodGroup.Protein => GapRole.Main,
        FoodGroup.Legume or FoodGroup.Vegetable or FoodGroup.Grain => GapRole.Side,
        _ => GapRole.Ingredient,
    };

    /// <summary>A recipe's role from its categories ("Dinner", "Salad"…), or, with no useful category, from its size.</summary>
    public static GapRole ClassifyRecipe(IEnumerable<string> categories, double kcalPerServing, GapFillPolicy policy)
    {
        var cats = string.Join(' ', categories).ToLowerInvariant();
        if (SideWords().IsMatch(cats) && kcalPerServing <= policy.MaxSideKcal) return GapRole.Side;
        if (SnackWords().IsMatch(cats) && kcalPerServing <= policy.MaxSnackKcal) return GapRole.Snack;
        if (MealWords().IsMatch(cats)) return kcalPerServing >= policy.MinMealKcal ? GapRole.Meal : (kcalPerServing >= policy.MinSnackKcal ? GapRole.Snack : GapRole.Side);
        if (kcalPerServing >= policy.MinMealKcal) return GapRole.Meal;
        return kcalPerServing >= policy.MinSnackKcal ? GapRole.Snack : GapRole.Side;
    }

    /// <summary>Snack groups that go well together. Your own history can add more pairs.</summary>
    public static bool Compatible(FoodGroup a, FoodGroup b)
    {
        static bool Is(FoodGroup x, FoodGroup y, FoodGroup p, FoodGroup q) => (x == p && y == q) || (x == q && y == p);
        return Is(a, b, FoodGroup.Dairy, FoodGroup.Fruit) || Is(a, b, FoodGroup.Dairy, FoodGroup.NutsSeeds) ||
               Is(a, b, FoodGroup.Fruit, FoodGroup.NutsSeeds) || Is(a, b, FoodGroup.Egg, FoodGroup.Fruit) ||
               Is(a, b, FoodGroup.Egg, FoodGroup.Vegetable) || Is(a, b, FoodGroup.Egg, FoodGroup.Cereal) ||
               Is(a, b, FoodGroup.Dairy, FoodGroup.Cereal) || Is(a, b, FoodGroup.Fruit, FoodGroup.Cereal) ||
               Is(a, b, FoodGroup.NutsSeeds, FoodGroup.Cereal);
    }

    /// <summary>What can sit next to a main: a vegetable, a grain or a legume; two sides must be a vegetable plus a grain/legume.</summary>
    public static bool IsMealSide(FoodGroup g) => g is FoodGroup.Vegetable or FoodGroup.Grain or FoodGroup.Legume;

    public static bool SidePair(FoodGroup a, FoodGroup b) =>
        (a == FoodGroup.Vegetable && b is FoodGroup.Grain or FoodGroup.Legume) || (b == FoodGroup.Vegetable && a is FoodGroup.Grain or FoodGroup.Legume);

    [GeneratedRegex(@"\b(salad|side|vegetable|slaw)\b")] private static partial Regex SideWords();
    [GeneratedRegex(@"\b(snack|appetizer|dip|dessert|cookie|treat|bar|smoothie|drink|beverage|breakfast bar|muffin)s?\b")] private static partial Regex SnackWords();
    [GeneratedRegex(@"\b(breakfast|lunch|dinner|main|entree|entrée|soup|stew|casserole|bowl|supper|pasta|curry|stir.?fry)s?\b")] private static partial Regex MealWords();
}
