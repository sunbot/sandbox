namespace NutriPlan.Domain.Grocery;

/// <summary>
/// An item the user removed from their grocery list. It is only a preference: the plan, recipes and snapshots are
/// never changed. The key identifies the ingredient, not an amount or a date range, so the exclusion holds as
/// quantities change, lines merge or split, and the list is rebuilt for any range, until the user restores it.
/// </summary>
public sealed class GroceryExclusion : Users.IOwned
{
    public const int MaxKeyLength = 200;

    public Guid OwnerId { get; private set; }
    public void AssignOwner(Guid ownerId) => OwnerId = Users.Ownership.Assign(OwnerId, ownerId);

    private GroceryExclusion() { } // EF

    public GroceryExclusion(string key, string name)
    {
        if (!IsValidKey(key)) throw new ArgumentException("Not a grocery item key.", nameof(key));
        Id = Guid.NewGuid();
        Key = key;
        Name = string.IsNullOrWhiteSpace(name) ? key : name.Trim()[..Math.Min(name.Trim().Length, 200)];
        CreatedAt = DateTimeOffset.UtcNow;
    }

    public Guid Id { get; private set; }
    public string Key { get; private set; } = "";
    public string Name { get; private set; } = "";
    public DateTimeOffset CreatedAt { get; private set; }

    /// <summary>"food:{id}" for a matched food (all recipes' lines of it are one item); otherwise "text:{lowercase name}".</summary>
    public static string KeyFor(Guid? foodId, string text) =>
        foodId is { } id ? $"food:{id}" : $"text:{text.Trim().ToLowerInvariant()}";

    public static bool IsValidKey(string? key) =>
        key is { Length: > 0 and <= MaxKeyLength } &&
        ((key.StartsWith("food:", StringComparison.Ordinal) && Guid.TryParse(key.AsSpan(5), out _)) ||
         (key.StartsWith("text:", StringComparison.Ordinal) && key.Length > 5 && key[5..].Trim().Length > 0));
}
