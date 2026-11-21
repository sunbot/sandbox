namespace NutriPlan.Domain.Pantry;

/// <summary>Something you have at home. Quantity is optional: "I have eggs" is useful on its own.</summary>
public sealed class PantryItem : Users.IOwned
{
    /// <summary>The user this record belongs to (set by the repository from the signed-in user).</summary>
    public Guid OwnerId { get; private set; }
    public void AssignOwner(Guid ownerId) => OwnerId = Users.Ownership.Assign(OwnerId, ownerId);

    private PantryItem() { } // EF

    public PantryItem(string name, Guid? foodId = null, double? grams = null, DateOnly? expiresOn = null)
    {
        if (string.IsNullOrWhiteSpace(name)) throw new ArgumentException("Name is required.", nameof(name));
        Id = Guid.NewGuid();
        Name = name.Trim();
        FoodId = foodId;
        Grams = grams;
        ExpiresOn = expiresOn;
        AddedAt = DateTimeOffset.UtcNow;
    }

    public Guid Id { get; private set; }
    public string Name { get; private set; } = "";
    public Guid? FoodId { get; private set; }
    public double? Grams { get; private set; }
    public DateOnly? ExpiresOn { get; private set; }
    /// <summary>Staples (salt, oil, spices) are assumed always available and never block a recipe.</summary>
    public bool IsStaple { get; set; }
    public DateTimeOffset AddedAt { get; private set; }

    public void Update(string name, Guid? foodId, double? grams, DateOnly? expiresOn)
    {
        Name = name.Trim();
        FoodId = foodId;
        Grams = grams;
        ExpiresOn = expiresOn;
    }

    /// <summary>Uses up some of the item (e.g. after cooking). Returns false when it's used up.</summary>
    public bool Consume(double grams)
    {
        if (Grams is null) return true;
        Grams = Math.Max(0, Grams.Value - grams);
        return Grams > 0;
    }
}
