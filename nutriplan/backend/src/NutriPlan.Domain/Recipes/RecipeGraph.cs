namespace NutriPlan.Domain.Recipes;

/// <summary>
/// How recipes use each other as ingredients. Recipes form a directed graph (recipe → the recipes it uses); it must stay
/// acyclic, because a recipe that (directly or through others) contains itself has no finite nutrition.
/// </summary>
public static class RecipeGraph
{
    /// <summary>
    /// Whether using <paramref name="childId"/> as an ingredient of <paramref name="parentId"/> would make a loop:
    /// the child is the parent itself, or the child already uses the parent somewhere inside it.
    /// </summary>
    public static bool WouldCreateCycle(Guid parentId, Guid childId, Func<Guid, IEnumerable<Guid>> usesOf) =>
        childId == parentId || Reaches(childId, parentId, usesOf);

    /// <summary>The chain of recipes from <paramref name="from"/> down to <paramref name="target"/>, or null if it isn't used there.</summary>
    public static IReadOnlyList<Guid>? PathTo(Guid from, Guid target, Func<Guid, IEnumerable<Guid>> usesOf)
    {
        var parent = new Dictionary<Guid, Guid>();
        var seen = new HashSet<Guid> { from };
        var queue = new Queue<Guid>([from]);
        while (queue.Count > 0)
        {
            var at = queue.Dequeue();
            if (at == target)
            {
                var path = new List<Guid> { at };
                while (parent.TryGetValue(at, out var p)) { path.Add(p); at = p; }
                path.Reverse();
                return path;
            }
            foreach (var next in usesOf(at))
                if (seen.Add(next)) { parent[next] = at; queue.Enqueue(next); }
        }
        return null;
    }

    public static bool Reaches(Guid from, Guid target, Func<Guid, IEnumerable<Guid>> usesOf) => PathTo(from, target, usesOf) is not null;

    /// <summary>
    /// The recipes that use any of <paramref name="changedIds"/> directly or indirectly, ordered so each comes after every
    /// recipe it uses: recalculating them in this order lets a change flow all the way up. A changed recipe is included only
    /// when it uses another changed one.
    /// </summary>
    public static IReadOnlyList<Guid> DependentsInOrder(IEnumerable<Guid> changedIds, IReadOnlyDictionary<Guid, IReadOnlyCollection<Guid>> uses)
    {
        var usedBy = new Dictionary<Guid, List<Guid>>();
        foreach (var (parent, children) in uses)
            foreach (var child in children)
                (usedBy.TryGetValue(child, out var l) ? l : usedBy[child] = []).Add(parent);

        var affected = new HashSet<Guid>();
        var queue = new Queue<Guid>(changedIds.Distinct());
        while (queue.Count > 0)
            foreach (var p in usedBy.GetValueOrDefault(queue.Dequeue()) ?? [])
                if (affected.Add(p)) queue.Enqueue(p);

        // Kahn's algorithm on the affected recipes: a recipe is ready once every affected recipe it uses is done.
        var pending = affected.ToDictionary(id => id, id => (uses.GetValueOrDefault(id) ?? []).Count(affected.Contains));
        var ready = new Queue<Guid>(pending.Where(kv => kv.Value == 0).Select(kv => kv.Key).OrderBy(id => id));
        var order = new List<Guid>();
        while (ready.Count > 0)
        {
            var id = ready.Dequeue();
            order.Add(id);
            foreach (var p in usedBy.GetValueOrDefault(id) ?? [])
                if (pending.ContainsKey(p) && --pending[p] == 0) ready.Enqueue(p);
        }
        return order; // recipes caught in a loop (which saving never allows) are left out rather than looping forever
    }
}

