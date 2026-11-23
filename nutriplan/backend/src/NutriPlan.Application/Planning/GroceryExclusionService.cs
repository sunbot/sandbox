using NutriPlan.Application.Abstractions;
using NutriPlan.Domain.Grocery;

namespace NutriPlan.Application.Planning;

public sealed record HideGroceryItemRequest(string Key, string? Name);

/// <summary>Removes items from (and restores them to) the signed-in user's grocery list. Never touches plans or recipes.</summary>
public sealed class GroceryExclusionService(IGroceryExclusionRepository exclusions, IUnitOfWork uow)
{
    /// <summary>Idempotent: hiding an already-hidden item changes nothing.</summary>
    public async Task HideAsync(HideGroceryItemRequest r, CancellationToken ct = default)
    {
        if (!GroceryExclusion.IsValidKey(r.Key)) throw new ArgumentException("Not a valid grocery item.");
        if ((await exclusions.ListAsync(ct)).Any(e => e.Key == r.Key)) return;
        exclusions.Add(new GroceryExclusion(r.Key, r.Name ?? ""));
        await uow.SaveChangesAsync(ct);
    }

    /// <summary>Restores one item by key, or every hidden item when no key is given.</summary>
    public async Task RestoreAsync(string? key, CancellationToken ct = default)
    {
        foreach (var e in (await exclusions.ListAsync(ct)).Where(e => key is null || e.Key == key).ToList()) exclusions.Remove(e);
        await uow.SaveChangesAsync(ct);
    }
}
