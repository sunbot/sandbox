namespace NutriPlan.Domain.Planning;

/// <summary>
/// Every threshold the gap recommender uses, in one place (bound from the "GapFill" configuration section, so any of
/// them can be tuned without a code change). Defaults are conservative: it is better to say "nothing fits" than to
/// suggest a token amount of food.
/// </summary>
public sealed class GapFillPolicy
{
    // ── Calories: what kind of suggestion the day has room for ────────────────────────────────────────
    /// <summary>Calories left below this (but not over) = on target: nothing is added, only swaps are offered.</summary>
    public double MinSnackKcal { get; set; } = 80;
    public double MaxSnackKcal { get; set; } = 300;
    /// <summary>At least this much room to suggest a meal; between the snack and meal minimums only snacks fit.</summary>
    public double MinMealKcal { get; set; } = 250;
    public double MaxMealKcal { get; set; } = 900;
    public double MinSideKcal { get; set; } = 40;
    public double MaxSideKcal { get; set; } = 300;
    /// <summary>Over by more than this share of the daily calorie target = "over": nothing is added.</summary>
    public double OverTolerancePct { get; set; } = 0.03;
    /// <summary>A suggestion may exceed the calories left by at most this share (rounding room, not a licence to overshoot).</summary>
    public double CalorieSlackPct { get; set; } = 0.05;

    // ── Portions ────────────────────────────────────────────────────────────────────────────────────
    /// <summary>Amounts are multiples of a real portion; never below this fraction of one.</summary>
    public double MinPortionFraction { get; set; } = 0.5;
    public double MaxPortionMultiple { get; set; } = 2;
    /// <summary>A food portion lighter than this isn't a serving (a teaspoon of something), so the food can't be suggested.</summary>
    public double MinPortionGrams { get; set; } = 15;
    public double MaxPortionGrams { get; set; } = 400;

    // ── Needs ───────────────────────────────────────────────────────────────────────────────────────
    /// <summary>A goal counts as a gap only when at least this share of its daily target is still missing.</summary>
    public double OpenNeedShare { get; set; } = 0.10;
    /// <summary>In a combination every item must supply at least this many calories (so a few leaves of spinach can't ride along).</summary>
    public double MinItemKcal { get; set; } = 25;
    /// <summary>A food or recipe counts as "eaten often" after being logged this many times in the last 90 days.</summary>
    public int FrequentMinCount { get; set; } = 3;
    /// <summary>Every item must cover at least this share of an open need (capped at what's still needed) to be worth suggesting.</summary>
    public double MinContributionShare { get; set; } = 0.10;
    /// <summary>A nutrient is judged only if it is known for at least this share of the calories logged today.</summary>
    public double MinDataCoverage { get; set; } = 0.8;
    /// <summary>A limit with this share of it (or less) left is "near": candidates with unknown values for it are skipped.</summary>
    public double NearLimitShare { get; set; } = 0.15;
    /// <summary>When a limit is already exceeded, a suggestion may add at most this share of the limit (essentially nothing).</summary>
    public double ExceededLimitTolerancePct { get; set; } = 0.02;

    // ── Ranking ─────────────────────────────────────────────────────────────────────────────────────
    public double ProteinWeight { get; set; } = 1.0;
    public double FiberWeight { get; set; } = 0.8;
    public double MicronutrientWeight { get; set; } = 0.5;
    /// <summary>Carbs and fat are shown but not chased by default (0): the gaps worth filling are protein, fiber and micronutrients.</summary>
    public double MacroWeight { get; set; } = 0;
    /// <summary>The score is the coverage of the few most important open needs, so many small gaps don't dilute it.</summary>
    public int ScoreNeedsConsidered { get; set; } = 3;
    /// <summary>A suggestion must cover at least this much of those needs (0–1+) to be shown at all.</summary>
    public double MinSuggestionScore { get; set; } = 0.25;
    public double CalorieFitWeight { get; set; } = 0.15;
    public double FavoriteBonus { get; set; } = 0.10;
    public double PantryBonus { get; set; } = 0.08;
    public double FrequentBonus { get; set; } = 0.06;
    public double SlotBonus { get; set; } = 0.04;
    public double CoEatenBonus { get; set; } = 0.08;
    public double ComplexityPenalty { get; set; } = 0.05;
    /// <summary>Pairs eaten together this many times in your diary count as a familiar combination.</summary>
    public int CoEatenMinCount { get; set; } = 2;
    public int MaxSuggestions { get; set; } = 3;
    /// <summary>How many top candidates per role are combined (bounds the search).</summary>
    public int CombinationPoolSize { get; set; } = 10;
    /// <summary>With fewer candidates than this, a short list of everyday staples is added so a new user still gets ideas.</summary>
    public int StarterThreshold { get; set; } = 25;

    // ── Explanations ────────────────────────────────────────────────────────────────────────────────
    /// <summary>A "helps close your X gap" reason needs the suggestion to cover at least this share of what's missing.</summary>
    public double ReasonMinShare { get; set; } = 0.15;
    /// <summary>"A useful source of X" needs at least this share of the daily target.</summary>
    public double UsefulSourceShare { get; set; } = 0.15;

    // ── Swaps and next-day ideas (over / at target) ─────────────────────────────────────────────────
    public double SwapMinSourceKcal { get; set; } = 150;
    public double SwapMinSavingsKcal { get; set; } = 100;
    /// <summary>A swap keeps at least this share of the original's calories (so it stays a real replacement, not just removal).</summary>
    public double SwapMinKeepShare { get; set; } = 0.4;
    public int MaxSwaps { get; set; } = 3;
    public double TipMinDailyShare { get; set; } = 0.15;
    public int MaxTipNutrients { get; set; } = 2;
    public int TipsPerNutrient { get; set; } = 3;
}
