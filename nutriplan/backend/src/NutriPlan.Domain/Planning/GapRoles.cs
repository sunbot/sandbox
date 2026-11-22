using System.Text.RegularExpressions;

namespace NutriPlan.Domain.Planning;

/// <summary>
/// What a food or recipe is in a day of eating (a main, a side, a ready-to-eat snack, or just an ingredient). This is
/// what lets the recommender assemble meals that make sense instead of arbitrary nutrient piles. It's a transparent,
/// tested rule table over the food's name and USDA category: no AI, and no nutrition numbers are involved.
/// </summary>
public static partial class GapRoles
{
    // Order matters: the first matching rule wins.
    private static readonly (Regex Pattern, FoodGroup Group, bool Ingredient)[] FoodRules =
    [
        (Rx(@"\b(peanut|almond|cashew|nut) butter\b"), FoodGroup.NutsSeeds, false),
        (Rx(@"\b(oil|shortening|lard|margarine|butter|sugar|syrup|honey|jam|jelly|flour|starch|salt|spice|seasoning|herb|vinegar|extract|baking|yeast|gelatin|sauce|dressing|ketchup|mustard|mayonnaise|salsa|coffee|tea|water|broth|bouillon|stock|powder|supplement|cocoa|flavou?ring|juice|soda|beverage|drink|candy|frosting)s?\b"), FoodGroup.Other, true),
        (Rx(@"\beggs?\b"), FoodGroup.Egg, false),
        (Rx(@"\b(yogurt|yoghurt|cottage cheese|cheese|milk|kefir|skyr)\b"), FoodGroup.Dairy, false),
        (Rx(@"\b(chicken|turkey|beef|steak|pork|ham|lamb|fish|salmon|tuna|cod|tilapia|trout|halibut|sardines?|shrimp|tofu|tempeh)\b"), FoodGroup.Protein, false),
        (Rx(@"\b(green beans|string beans|snap beans?|beans?, snap|snap peas?|snow peas?)\b"), FoodGroup.Vegetable, false),
        (Rx(@"\b(beans?|lentils?|chickpeas?|peas|hummus|edamame)\b"), FoodGroup.Legume, false),
        (Rx(@"\b(almonds?|walnuts?|pecans?|cashews?|pistachios?|peanuts?|hazelnuts?|seeds?|nuts|trail mix)\b"), FoodGroup.NutsSeeds, false),
        (Rx(@"\b(apples?|bananas?|berry|berries|oranges?|grapes?|melon|pears?|peach(es)?|plums?|mango(es)?|pineapple|cherr(y|ies)|kiwi|fruit|avocados?|apricots?|nectarines?|papaya|tangerines?|clementines?|grapefruit)\b"), FoodGroup.Fruit, false),
        (Rx(@"\b(broccoli|spinach|kale|carrots?|peppers?|tomato(es)?|cucumbers?|lettuce|zucchini|squash|cauliflower|cabbage|asparagus|celery|mushrooms?|onions?|beets?|brussels|salad|vegetables?|eggplant|greens)\b"), FoodGroup.Vegetable, false),
        (Rx(@"\b(rice|pasta|spaghetti|noodles?|bread|bagels?|oats?|oatmeal|quinoa|tortillas?|cereal|potatoes|potato|couscous|barley|bulgur|crackers?|granola|buns?)\b"), FoodGroup.Grain, false),
    ];

    /// <summary>True when a rule matched (even an ingredient rule); false for a food the table knows nothing about.</summary>
    public static bool Recognized(string name, string? category)
    {
        var text = $"{name} {category}".ToLowerInvariant();
        return FoodRules.Any(r => r.Pattern.IsMatch(text));
    }

    public static (FoodGroup Group, GapRole Role) ClassifyFood(string name, string? category)
    {
        var text = $"{name} {category}".ToLowerInvariant();
        foreach (var (pattern, group, ingredient) in FoodRules)
        {
            if (!pattern.IsMatch(text)) continue;
            return (group, ingredient ? GapRole.Ingredient : RoleOf(group));
        }
        return (FoodGroup.Other, GapRole.Ingredient); // unknown: not suggested unless the user eats it (the service decides)
    }

    public static GapRole RoleOf(FoodGroup group) => group switch
    {
        FoodGroup.Egg or FoodGroup.Dairy or FoodGroup.Fruit or FoodGroup.NutsSeeds => GapRole.Snack,
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

    /// <summary>Groups that go well together: used to build snack pairs and meals (a main + sides). Your own history can add more.</summary>
    public static bool Compatible(FoodGroup a, FoodGroup b)
    {
        static bool Is(FoodGroup x, FoodGroup y, FoodGroup p, FoodGroup q) => (x == p && y == q) || (x == q && y == p);
        return Is(a, b, FoodGroup.Dairy, FoodGroup.Fruit) || Is(a, b, FoodGroup.Dairy, FoodGroup.NutsSeeds) ||
               Is(a, b, FoodGroup.Fruit, FoodGroup.NutsSeeds) || Is(a, b, FoodGroup.Egg, FoodGroup.Fruit) ||
               Is(a, b, FoodGroup.Egg, FoodGroup.Vegetable);
    }

    private static Regex Rx(string p) => new(p, RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Compiled);

    [GeneratedRegex(@"\b(salad|side|vegetable|slaw)\b")] private static partial Regex SideWords();
    [GeneratedRegex(@"\b(snack|appetizer|dip|dessert|cookie|treat|bar|smoothie|drink|beverage|breakfast bar|muffin)s?\b")] private static partial Regex SnackWords();
    [GeneratedRegex(@"\b(breakfast|lunch|dinner|main|entree|entrée|soup|stew|casserole|bowl|supper|pasta|curry|stir.?fry)s?\b")] private static partial Regex MealWords();
}
