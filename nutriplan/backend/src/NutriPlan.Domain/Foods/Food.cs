using NutriPlan.Domain.Nutrients;

namespace NutriPlan.Domain.Foods;

/// <summary>Where a food's numbers came from. Order matters: lower = more trustworthy.</summary>
public enum FoodSource
{
    UsdaFoundation = 0,   // lab-analyzed, USDA
    UsdaSrLegacy = 1,     // lab-analyzed + calculated, USDA (frozen 2018 but very broad)
    UsdaSurvey = 2,       // FNDDS: "as eaten" foods & mixed dishes
    UsdaBranded = 3,      // manufacturer-submitted labels via USDA
    User = 4,             // entered or corrected by you
    OpenFoodFacts = 5,    // crowd-sourced barcode data
    Recipe = 6,           // a saved recipe exposed as a food (per serving)
}

/// <summary>How much the app trusts a food's numbers. Drives search ranking and UI badges.</summary>
public enum DataQuality { Verified = 0, Standard = 1, Unverified = 2, Flagged = 3 }

public sealed record FoodPortion(string Description, double GramWeight, double Amount = 1)
{
    /// <summary>Grams for a single unit of this portion ("1 cup" → gram weight / amount).</summary>
    public double GramsPerUnit => Amount > 0 ? GramWeight / Amount : GramWeight;
}

public sealed class Food
{
    private List<FoodPortion> _portions = [];

    private Food() { } // EF

    public Food(
        string name,
        FoodSource source,
        NutrientProfile nutrientsPer100g,
        string? sourceId = null,
        string? brand = null,
        string? barcode = null,
        string? category = null,
        IEnumerable<FoodPortion>? portions = null)
    {
        if (string.IsNullOrWhiteSpace(name)) throw new ArgumentException("Name is required.", nameof(name));
        Id = Guid.NewGuid();
        Name = name.Trim();
        Source = source;
        SourceId = sourceId;
        Brand = string.IsNullOrWhiteSpace(brand) ? null : brand.Trim();
        Barcode = NormalizeBarcode(barcode);
        Category = category;
        NutrientsPer100g = nutrientsPer100g;
        _portions = portions?.ToList() ?? [];
        Quality = DefaultQualityFor(source);
        CreatedAt = UpdatedAt = DateTimeOffset.UtcNow;
        ReassessQuality();
    }

    public Guid Id { get; private set; }
    public string Name { get; private set; } = "";
    public string? Brand { get; private set; }
    public FoodSource Source { get; private set; }
    /// <summary>Identifier in the source system (USDA fdc_id, OFF code, ...).</summary>
    public string? SourceId { get; private set; }
    public string? Barcode { get; private set; }
    public string? Category { get; private set; }
    public DataQuality Quality { get; private set; }
    public string? QualityNote { get; private set; }
    public NutrientProfile NutrientsPer100g { get; private set; } = NutrientProfile.Empty;
    public IReadOnlyList<FoodPortion> Portions => _portions;
    public bool IsArchived { get; private set; }
    public DateTimeOffset CreatedAt { get; private set; }
    public DateTimeOffset UpdatedAt { get; private set; }

    public string DisplayName => Brand is null ? Name : $"{Name} ({Brand})";

    public NutrientProfile NutrientsFor(double grams) => NutrientsPer100g.ForGrams(grams);

    public void UpdateNutrients(NutrientProfile per100g)
    {
        NutrientsPer100g = per100g;
        Touch();
        ReassessQuality();
    }

    public void ReplacePortions(IEnumerable<FoodPortion> portions)
    {
        _portions = portions.ToList();
        Touch();
    }

    public void Rename(string name, string? brand)
    {
        Name = name.Trim();
        Brand = string.IsNullOrWhiteSpace(brand) ? null : brand.Trim();
        Touch();
    }

    public void AssignBarcode(string? barcode)
    {
        Barcode = NormalizeBarcode(barcode);
        Touch();
    }

    /// <summary>The user has checked this food against a label or a trusted source.</summary>
    public void MarkVerified()
    {
        Quality = DataQuality.Verified;
        QualityNote = "Verified by you.";
        Touch();
    }

    public void Archive() { IsArchived = true; Touch(); }

    /// <summary>USDA lab data uses food-specific energy factors, so a 4/4/9 mismatch there isn't an error.</summary>
    public bool IsLabAnalyzed => Source is FoodSource.UsdaFoundation or FoodSource.UsdaSrLegacy or FoodSource.UsdaSurvey;

    private void ReassessQuality()
    {
        if (IsLabAnalyzed) return;
        var check = EnergyConsistency.Check(NutrientsPer100g);
        if (check.Status == ConsistencyStatus.Inconsistent)
        {
            Quality = DataQuality.Flagged;
            QualityNote = check.Message;
        }
        else if (check.Status == ConsistencyStatus.Suspicious)
        {
            QualityNote = check.Message;
            if (Quality < DataQuality.Unverified) Quality = DataQuality.Unverified;
        }
        else if (check.Status == ConsistencyStatus.Unknown)
        {
            QualityNote = check.Message;
        }
    }

    private void Touch() => UpdatedAt = DateTimeOffset.UtcNow;

    public static DataQuality DefaultQualityFor(FoodSource source) => source switch
    {
        FoodSource.UsdaFoundation or FoodSource.UsdaSrLegacy or FoodSource.UsdaSurvey => DataQuality.Verified,
        FoodSource.UsdaBranded or FoodSource.User or FoodSource.Recipe => DataQuality.Standard,
        _ => DataQuality.Unverified,
    };

    /// <summary>Strips non-digits and normalizes UPC-A (12) to EAN-13 so both scan formats match.</summary>
    /// <summary>
    /// A normalized code that can be a retail product: 8 digits (EAN-8 / UPC-E, whose check digit is computed on the expanded
    /// form, so not checked here) or 13/14 digits with a valid GS1 check digit.
    /// </summary>
    public static bool IsPlausibleBarcode(string normalized)
    {
        if (normalized.Length == 8) return true;
        if (normalized.Length is not (13 or 14)) return false;
        var sum = 0;
        for (var i = 0; i < normalized.Length - 1; i++)
        {
            var d = normalized[normalized.Length - 2 - i] - '0';
            sum += i % 2 == 0 ? d * 3 : d;
        }
        return (10 - sum % 10) % 10 == normalized[^1] - '0';
    }

    public static string? NormalizeBarcode(string? barcode)
    {
        if (string.IsNullOrWhiteSpace(barcode)) return null;
        var digits = new string(barcode.Where(char.IsDigit).ToArray());
        if (digits.Length == 0) return null;
        if (digits.Length == 12) digits = "0" + digits;
        if (digits.Length == 14 && digits[0] == '0') digits = digits[1..]; // GTIN-14 with leading zero
        return digits;
    }
}
