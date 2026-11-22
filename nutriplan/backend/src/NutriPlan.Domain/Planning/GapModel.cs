using NutriPlan.Domain.Diary;
using NutriPlan.Domain.Nutrients;

namespace NutriPlan.Domain.Planning;

/// <summary>How much room the day has: Open (a meal fits), Near (a snack fits), AtTarget (nothing to add), Over.</summary>
public enum GapSituation { Open, Near, AtTarget, Over }

/// <summary>Which candidate pool and calorie window to use. Each changes the real constraints, not just the labels.</summary>
public enum GapMode { BestMatch, Meal, QuickSnack, Pantry, SavedRecipes }

/// <summary>What a food or recipe is in a day of eating. Ingredients are never suggested on their own.</summary>
public enum GapRole { Meal, Main, Side, Snack, Ingredient }

/// <summary>The kind of thing a suggestion is, shown on its card.</summary>
public enum GapCategory { Meal, Snack, Side }

/// <summary>Cereal = breakfast and snack grains (oatmeal, cereal, bread, crackers); Grain = meal bases (rice, pasta, potato); Mixed = a prepared dish (soup, pizza, sandwich) sized by its calories.</summary>
public enum FoodGroup { Other, Dairy, Egg, Protein, Legume, NutsSeeds, Fruit, Vegetable, Grain, Cereal, Mixed }

[Flags]
public enum GapOrigin { None = 0, SavedRecipe = 1, Favorite = 2, Pantry = 4, Frequent = 8, Starter = 16 }

/// <summary>
/// Something the recommender may suggest, sized in real portions. <see cref="PerPortion"/> is the nutrition of ONE
/// portion (a labelled serving, one egg, your usual amount, a recipe serving); quantities are multiples of it.
/// </summary>
public sealed record GapCandidate(
    string Key,
    ItemKind Kind,
    Guid? FoodId,
    Guid? RecipeId,
    string Name,
    GapRole Role,
    FoodGroup Group,
    GapOrigin Origin,
    NutrientProfile PerPortion,
    double PortionAmount,
    string Unit,
    string PortionLabel,
    bool Countable = false,
    double MaxMultiple = double.MaxValue,
    int Familiarity = 0,
    IReadOnlySet<MealSlot>? Slots = null)
{
    public bool IsRecipe => Kind == ItemKind.Recipe;
}

public sealed record GapSuggestionItem(GapCandidate Candidate, double Multiple)
{
    public double Amount => Multiple * Candidate.PortionAmount;
    public NutrientProfile Nutrients => Candidate.PerPortion.Scale(Multiple);
}

/// <summary>A nutrient to aim for (or stay under): what's still missing, the daily target, its weight, and whether the day's data supports judging it.</summary>
public sealed record GapTarget(int NutrientId, double Remaining, double DailyTarget, TargetKind Kind, double Weight, bool Evaluable = true);

/// <summary>One reason for a suggestion. <see cref="Text"/> is built only from the calculated numbers.</summary>
public sealed record GapReason(string Code, string Text, int? NutrientId = null);

/// <summary>What a suggestion does to one nutrient: for a goal, how much is still missing before/after; for a limit, how much room is left.</summary>
public sealed record GapEffect(int NutrientId, double Before, double After, TargetKind Kind);

public sealed record GapSuggestion(
    IReadOnlyList<GapSuggestionItem> Items,
    GapCategory Category,
    NutrientProfile Added,
    NutrientProfile RemainingAfter,
    double Score,
    IReadOnlyList<GapReason> Reasons,
    IReadOnlyList<GapEffect> Effects);

/// <summary>An uneaten planned item, as the swap finder sees it.</summary>
public sealed record GapPlanned(Guid EntryId, string Name, GapCategory Category, NutrientProfile Nutrients, string? Key = null);

public sealed record GapSwap(GapPlanned From, GapSuggestionItem To, double SavesKcal, IReadOnlyList<GapReason> Reasons);

public sealed record GapTipItem(GapCandidate Candidate, double NutrientAmount, double DailyShare);

/// <summary>For a nutrient that ran short today: familiar foods that are real sources of it, for tomorrow.</summary>
public sealed record GapTip(int NutrientId, IReadOnlyList<GapTipItem> Items);

/// <summary>What the recommender needs to know beyond targets and candidates.</summary>
public sealed record GapContext(MealSlot? Meal = null, IReadOnlySet<string>? CoEaten = null)
{
    public static string PairKey(string a, string b) => string.CompareOrdinal(a, b) <= 0 ? $"{a}|{b}" : $"{b}|{a}";
}
