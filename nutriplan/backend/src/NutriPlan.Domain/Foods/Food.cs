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

    private void ReassessQuality()
    {
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
        FoodSource.UsdaFoundation or FoodSource.UsdaSrLegacy => DataQuality.Verified,
        FoodSource.UsdaSurvey or FoodSource.UsdaBranded or FoodSource.User or FoodSource.Recipe => DataQuality.Standard,
        _ => DataQuality.Unverified,
    };

    /// <summary>Strips non-digits and normalizes UPC-A (12) to EAN-13 so both scan formats match.</summary>
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
