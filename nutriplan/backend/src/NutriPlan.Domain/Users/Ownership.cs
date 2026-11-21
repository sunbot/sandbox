namespace NutriPlan.Domain.Users;

/// <summary>
/// A record that belongs to one user. The owner is set once, by the repository, from the signed-in user — never from
/// request data — and can't be changed afterwards.
/// </summary>
public interface IOwned
{
    Guid OwnerId { get; }
    void AssignOwner(Guid ownerId);
}

public static class Ownership
{
    /// <summary>Sets an owner once; assigning a different owner later is a bug, so it throws.</summary>
    public static Guid Assign(Guid current, Guid next)
    {
        if (next == Guid.Empty) throw new ArgumentException("Owner is required.", nameof(next));
        if (current != Guid.Empty && current != next) throw new InvalidOperationException("This record already belongs to someone else.");
        return next;
    }
}
