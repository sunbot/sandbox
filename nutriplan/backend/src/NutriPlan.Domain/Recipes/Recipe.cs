using NutriPlan.Domain.Nutrients;
using NutriPlan.Domain.Parsing;

namespace NutriPlan.Domain.Recipes;

public enum RecipeOrigin { Manual, Paprika, WebPage, Assistant }

public enum IngredientMatchStatus
{
    Unmatched,      // couldn't find a food
    AutoMatched,    // best guess, user hasn't confirmed
    Confirmed,      // user picked or approved the food and amount
    Ignored,        // intentionally excluded (water, "salt to taste", section headers)
}

public sealed class RecipeIngredient
{
    public int Position { get; set; }
    public string RawText { get; set; } = "";
    public double? Amount { get; set; }
    public string? Unit { get; set; }
    public string FoodText { get; set; } = "";
    public string? Preparation { get; set; }
    public Guid? FoodId { get; set; }
    public string? FoodName { get; set; }
    public double? Grams { get; set; }
    public IngredientMatchStatus Status { get; set; }
    /// <summary>0–1 confidence of the automatic match, for UI highlighting.</summary>
    public double MatchConfidence { get; set; }
    public string? ResolutionNote { get; set; }

    public bool CountsTowardNutrition => Status is IngredientMatchStatus.AutoMatched or IngredientMatchStatus.Confirmed
                                         && FoodId is not null && Grams is not null;

    public static RecipeIngredient FromText(string line, int position)
    {
        var parsed = QuantityTextParser.Parse(line);
        var isHeader = IsSectionHeader(line);
        return new RecipeIngredient
        {
            Position = position,
            RawText = line.Trim(),
            Amount = parsed.Amount,
            Unit = parsed.Unit,
            FoodText = parsed.FoodText,
            Preparation = parsed.Preparation,
            Status = isHeader ? IngredientMatchStatus.Ignored : IngredientMatchStatus.Unmatched,
            ResolutionNote = isHeader ? "Section header" : null,
        };
    }

    /// <summary>Paprika and many sites use lines like "For the sauce:" or "SAUCE" as headers.</summary>
    public static bool IsSectionHeader(string line)
    {
        var t = line.Trim().TrimStart('-', '*', '•', '#').Trim();
        if (t.Length == 0) return true;
        if (t.EndsWith(':')) return true;
        // "Ingredients (for 4 servings)", recipe-site scaling buttons "1X 2X 3X".
        if (System.Text.RegularExpressions.Regex.IsMatch(t, @"^(ingredients|for the\b[^,]*$)", System.Text.RegularExpressions.RegexOptions.IgnoreCase)) return true;
        if (System.Text.RegularExpressions.Regex.IsMatch(t, @"^(\d+\s*[xX]\s*)+$")) return true;
        // ALL-CAPS headings, ignoring notes in parentheses: "AROMATICS (BOWL 2)".
        var bare = System.Text.RegularExpressions.Regex.Replace(t, @"\([^)]*\)", "").Trim();
        return bare.Length is > 0 and < 40 && bare.Any(char.IsLetter) && !bare.Any(char.IsDigit) && bare == bare.ToUpperInvariant();
    }
}

public sealed class Recipe
{
    private List<RecipeIngredient> _ingredients = [];
    private List<string> _categories = [];

    private Recipe() { } // EF

    public Recipe(string name, double servings, RecipeOrigin origin = RecipeOrigin.Manual)
    {
        if (string.IsNullOrWhiteSpace(name)) throw new ArgumentException("Name is required.", nameof(name));
        Id = Guid.NewGuid();
        Name = name.Trim();
        Servings = servings > 0 ? servings : 1;
        Origin = origin;
        CreatedAt = UpdatedAt = DateTimeOffset.UtcNow;
    }

    public Guid Id { get; private set; }
    public string Name { get; private set; } = "";
    public double Servings { get; private set; } = 1;
    public string? ServingDescription { get; set; }
    public RecipeOrigin Origin { get; private set; }
    /// <summary>Id in the source system (Paprika uid) so re-imports update instead of duplicating.</summary>
    public string? ExternalId { get; set; }
    public string? SourceName { get; set; }
    public string? SourceUrl { get; set; }
    public string? Description { get; set; }
    public string? Directions { get; set; }
    public string? Notes { get; set; }
    public string? PrepTime { get; set; }
    public string? CookTime { get; set; }
    public string? TotalTime { get; set; }
    public string? ImageUrl { get; set; }
    public byte[]? Photo { get; set; }
    public int? Rating { get; set; }
    /// <summary>Weight of the finished dish. When set, a "serving" can be logged by weight accurately.</summary>
    public double? CookedWeightGrams { get; set; }
    /// <summary>Nutrition as stated by the source (Paprika's free-text field). Shown for comparison only.</summary>
    public string? SourceNutritionText { get; set; }
    public bool IsFavorite { get; set; }
    public IReadOnlyList<RecipeIngredient> Ingredients => _ingredients;
    public IReadOnlyList<string> Categories => _categories;

    /// <summary>Cached result of <see cref="RecipeNutritionCalculator"/>; refreshed whenever ingredients change.</summary>
    public NutrientProfile NutritionPerServing { get; private set; } = NutrientProfile.Empty;
    /// <summary>Share of ingredient lines that contribute to nutrition (0–1). Low coverage = numbers are a lower bound.</summary>
    public double NutritionCoverage { get; private set; }
    public DateTimeOffset CreatedAt { get; private set; }
    public DateTimeOffset UpdatedAt { get; private set; }

    public void Rename(string name) { Name = name.Trim(); Touch(); }

    public void SetServings(double servings)
    {
        if (servings <= 0) throw new ArgumentOutOfRangeException(nameof(servings));
        Servings = servings;
        Touch();
    }

    public void SetCategories(IEnumerable<string> categories)
    {
        _categories = categories.Select(c => c.Trim()).Where(c => c.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        Touch();
    }

    public void SetIngredientLines(IEnumerable<string> lines)
    {
        _ingredients = lines
            .Select(l => l.Trim())
            .Where(l => l.Length > 0)
            .Select((l, i) => RecipeIngredient.FromText(l, i))
            .ToList();
        Touch();
    }

    /// <summary>
    /// Re-reads ingredient lines with the current parser (optionally new lines from a re-import). Lines you confirmed
    /// or excluded yourself are kept as they are when their text hasn't changed; everything else starts fresh.
    /// </summary>
    public void ReparseIngredients(IEnumerable<string>? lines = null)
    {
        var keep = _ingredients
            .Where(i => i.Status is IngredientMatchStatus.Confirmed || (i.Status is IngredientMatchStatus.Ignored && i.ResolutionNote == "Excluded by you"))
            .ToDictionary(i => i.Position);
        var source = (lines ?? _ingredients.OrderBy(i => i.Position).Select(i => i.RawText)).Select(l => l.Trim()).Where(l => l.Length > 0);
        _ingredients = source
            .Select((l, i) => keep.TryGetValue(i, out var old) && old.RawText == l ? old : RecipeIngredient.FromText(l, i))
            .ToList();
        Touch();
    }

    public void ReplaceIngredients(IEnumerable<RecipeIngredient> ingredients)
    {
        _ingredients = ingredients.OrderBy(i => i.Position).ToList();
        Touch();
    }

    public RecipeIngredient GetIngredient(int position) =>
        _ingredients.FirstOrDefault(i => i.Position == position)
        ?? throw new KeyNotFoundException($"Ingredient {position} not found.");

    public void ApplyNutrition(RecipeNutrition nutrition)
    {
        NutritionPerServing = nutrition.PerServing.Rounded();
        NutritionCoverage = nutrition.Coverage;
        Touch();
    }

    /// <summary>Grams of the finished dish in one serving, when the cooked weight is known.</summary>
    public double? GramsPerServing => CookedWeightGrams is > 0 ? CookedWeightGrams / Servings : null;

    private void Touch() => UpdatedAt = DateTimeOffset.UtcNow;
}
