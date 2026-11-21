using Microsoft.EntityFrameworkCore;
using NutriPlan.Application.Abstractions;
using NutriPlan.Application.Foods;
using NutriPlan.Domain.Diary;
using NutriPlan.Domain.Foods;
using NutriPlan.Domain.Pantry;
using NutriPlan.Domain.Planning;
using NutriPlan.Domain.Recipes;

namespace NutriPlan.Infrastructure.Persistence;

public sealed class FoodRepository(NutriPlanDbContext db) : IFoodRepository
{
    public Task<Food?> GetAsync(Guid id, CancellationToken ct = default) => db.Foods.FirstOrDefaultAsync(f => f.Id == id, ct);

    public async Task<IReadOnlyDictionary<Guid, Food>> GetManyAsync(IEnumerable<Guid> ids, CancellationToken ct = default)
    {
        var list = ids.Distinct().ToList();
        if (list.Count == 0) return new Dictionary<Guid, Food>();
        return await db.Foods.Where(f => list.Contains(f.Id)).ToDictionaryAsync(f => f.Id, ct);
    }

    public Task<Food?> FindByBarcodeAsync(string normalizedBarcode, CancellationToken ct = default) =>
        db.Foods.Where(f => f.Barcode == normalizedBarcode && !f.IsArchived)
            .OrderBy(f => f.Source == FoodSource.User ? 0 : f.Source == FoodSource.UsdaBranded ? 1 : 2)
            .FirstOrDefaultAsync(ct);

    public Task<Food?> FindBySourceAsync(FoodSource source, string sourceId, CancellationToken ct = default) =>
        db.Foods.FirstOrDefaultAsync(f => f.Source == source && f.SourceId == sourceId, ct);

    /// <summary>
    /// Candidates whose name/brand contains every query word (trigram-indexed ILIKE). If that finds
    /// too few, falls back to "any word". Final ordering is done by <see cref="FoodRanker"/>.
    /// </summary>
    public async Task<IReadOnlyList<FoodSearchRow>> SearchAsync(string query, int limit, CancellationToken ct = default)
    {
        // Substring patterns need a stem that's contained in every form: "blueberry" isn't in "blueberries".
        var tokens = FoodRanker.Tokens(query).Select(t => t.Length > 4 && t.EndsWith('y') ? t[..^1] : t).Distinct().Take(6).ToList();
        if (tokens.Count == 0) return [];

        var all = db.Foods.AsNoTracking().Where(f => !f.IsArchived);
        foreach (var t in tokens)
        {
            var pattern = $"%{Escape(t)}%";
            all = all.Where(f => EF.Functions.ILike(f.Name, pattern) || (f.Brand != null && EF.Functions.ILike(f.Brand, pattern)));
        }
        // Prefer names that start with the first word ("Milk, whole, ...") before shorter but unrelated ones.
        var prefix = $"{Escape(tokens[0])}%";
        var results = await all
            .OrderByDescending(f => EF.Functions.ILike(f.Name, prefix))
            .ThenBy(f => f.Name.Length)
            .Take(limit)
            .ToListAsync(ct);

        if (results.Count < limit / 4 && tokens.Count > 1)
        {
            var patterns = tokens.Select(t => $"%{Escape(t)}%").ToArray();
            var any = await db.Foods.AsNoTracking()
                .Where(f => !f.IsArchived && patterns.Any(p => EF.Functions.ILike(f.Name, p)))
                .OrderBy(f => f.Name.Length)
                .Take(limit)
                .ToListAsync(ct);
            results = results.Concat(any).DistinctBy(f => f.Id).ToList();
        }

        var usage = await UsageCountsAsync(results.Select(r => r.Id).ToList(), ct);
        return results.Select(f => new FoodSearchRow(f, Similarity(query, f.Name), usage.GetValueOrDefault(f.Id))).ToList();
    }

    public void Add(Food food) => db.Foods.Add(food);

    /// <summary>How often each food has been logged (reads the jsonb item snapshot).</summary>
    private async Task<Dictionary<Guid, int>> UsageCountsAsync(List<Guid> ids, CancellationToken ct)
    {
        if (ids.Count == 0) return [];
        var idStrings = ids.Select(i => i.ToString()).ToArray();
        var rows = await db.Database
            .SqlQuery<UsageRow>($"""
                SELECT item->>'foodId' AS food_id, COUNT(*)::int AS count
                FROM diary_entries
                WHERE item->>'foodId' = ANY({idStrings})
                GROUP BY item->>'foodId'
                """)
            .ToListAsync(ct);
        return rows.Where(r => Guid.TryParse(r.FoodId, out _)).ToDictionary(r => Guid.Parse(r.FoodId!), r => r.Count);
    }

    private static string Escape(string s) => s.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_");

    /// <summary>Trigram Jaccard similarity (0–1), same idea as Postgres pg_trgm, computed locally.</summary>
    public static double Similarity(string a, string b)
    {
        static HashSet<string> Grams(string s)
        {
            var t = "  " + s.ToLowerInvariant() + " ";
            var set = new HashSet<string>();
            for (var i = 0; i + 3 <= t.Length; i++) set.Add(t.Substring(i, 3));
            return set;
        }
        var ga = Grams(a); var gb = Grams(b);
        var inter = ga.Count(gb.Contains);
        var union = ga.Count + gb.Count - inter;
        return union == 0 ? 0 : (double)inter / union;
    }

    private sealed record UsageRow(string? FoodId, int Count);
}

public sealed class RecipeRepository(NutriPlanDbContext db) : IRecipeRepository
{
    public Task<Recipe?> GetAsync(Guid id, CancellationToken ct = default) => db.Recipes.FirstOrDefaultAsync(r => r.Id == id, ct);

    public async Task<IReadOnlyDictionary<Guid, Recipe>> GetManyAsync(IEnumerable<Guid> ids, CancellationToken ct = default)
    {
        var list = ids.Distinct().ToList();
        if (list.Count == 0) return new Dictionary<Guid, Recipe>();
        return await db.Recipes.Where(r => list.Contains(r.Id)).ToDictionaryAsync(r => r.Id, ct);
    }

    public Task<Recipe?> FindByExternalIdAsync(RecipeOrigin origin, string externalId, CancellationToken ct = default) =>
        db.Recipes.FirstOrDefaultAsync(r => r.Origin == origin && r.ExternalId == externalId, ct);

    public async Task<IReadOnlyList<Recipe>> ListAsync(string? search = null, string? category = null, CancellationToken ct = default)
    {
        var all = await db.Recipes.OrderByDescending(r => r.IsFavorite).ThenBy(r => r.Name).ToListAsync(ct);
        IEnumerable<Recipe> q = all;
        if (!string.IsNullOrWhiteSpace(category))
            q = q.Where(r => r.Categories.Contains(category, StringComparer.OrdinalIgnoreCase));
        if (!string.IsNullOrWhiteSpace(search))
        {
            var words = FoodRanker.Tokens(search).ToList();
            q = q.Where(r =>
            {
                var hay = FoodRanker.Tokens($"{r.Name} {string.Join(' ', r.Categories)} {r.Description}").ToHashSet();
                return words.All(w => hay.Contains(w) || hay.Any(h => h.StartsWith(w)));
            });
        }
        return q.ToList();
    }

    public void Add(Recipe recipe) => db.Recipes.Add(recipe);
    public void Remove(Recipe recipe) => db.Recipes.Remove(recipe);
}

public sealed class DiaryRepository(NutriPlanDbContext db) : IDiaryRepository
{
    public Task<DiaryEntry?> GetAsync(Guid id, CancellationToken ct = default) => db.DiaryEntries.FirstOrDefaultAsync(e => e.Id == id, ct);

    public async Task<IReadOnlyList<DiaryEntry>> GetRangeAsync(DateOnly from, DateOnly to, CancellationToken ct = default) =>
        await db.DiaryEntries.Where(e => e.Date >= from && e.Date <= to).OrderBy(e => e.Date).ThenBy(e => e.LoggedAt).ToListAsync(ct);

    public async Task<IReadOnlySet<Guid>> GetLinkedPlanEntryIdsAsync(IReadOnlyCollection<Guid> planEntryIds, CancellationToken ct = default) =>
        planEntryIds.Count == 0
            ? new HashSet<Guid>()
            : (await db.DiaryEntries.AsNoTracking().Where(e => e.PlanEntryId != null && planEntryIds.Contains(e.PlanEntryId.Value))
                .Select(e => e.PlanEntryId!.Value).ToListAsync(ct)).ToHashSet();

    public async Task<IReadOnlyList<FrequentItem>> GetFrequentItemsAsync(int days, int limit, CancellationToken ct = default)
    {
        var since = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(-days));
        var entries = await db.DiaryEntries.AsNoTracking().Where(e => e.Date >= since).ToListAsync(ct);
        return entries
            .Where(e => e.Item.Kind != ItemKind.QuickCalories)
            .GroupBy(e => (e.Item.FoodId, e.Item.RecipeId))
            .Select(g =>
            {
                var latest = g.OrderByDescending(e => e.LoggedAt).First();
                var usualMeal = g.GroupBy(e => e.Meal).OrderByDescending(m => m.Count()).First().Key;
                return new FrequentItem(latest.Item, usualMeal, g.Count(), latest.LoggedAt);
            })
            .OrderByDescending(f => f.Count).ThenByDescending(f => f.LastLogged)
            .Take(limit)
            .ToList();
    }

    public void Add(DiaryEntry entry) => db.DiaryEntries.Add(entry);
    public void Remove(DiaryEntry entry) => db.DiaryEntries.Remove(entry);
}

public sealed class PlanRepository(NutriPlanDbContext db) : IPlanRepository
{
    public Task<PlanEntry?> GetAsync(Guid id, CancellationToken ct = default) => db.PlanEntries.FirstOrDefaultAsync(e => e.Id == id, ct);

    public async Task<IReadOnlyList<PlanEntry>> GetRangeAsync(DateOnly from, DateOnly to, CancellationToken ct = default) =>
        await db.PlanEntries.Where(e => e.Date >= from && e.Date <= to).OrderBy(e => e.Date).ThenBy(e => e.Meal).ToListAsync(ct);

    public async Task<IReadOnlyList<PlanEntry>> GetBatchAsync(Guid batchId, CancellationToken ct = default) =>
        await db.PlanEntries.Where(e => e.BatchId == batchId).OrderBy(e => e.Date).ToListAsync(ct);

    public void Add(PlanEntry entry) => db.PlanEntries.Add(entry);
    public void Remove(PlanEntry entry) => db.PlanEntries.Remove(entry);
}

public sealed class PantryRepository(NutriPlanDbContext db) : IPantryRepository
{
    public Task<PantryItem?> GetAsync(Guid id, CancellationToken ct = default) => db.PantryItems.FirstOrDefaultAsync(p => p.Id == id, ct);
    public async Task<IReadOnlyList<PantryItem>> ListAsync(CancellationToken ct = default) => await db.PantryItems.ToListAsync(ct);
    public void Add(PantryItem item) => db.PantryItems.Add(item);
    public void Remove(PantryItem item) => db.PantryItems.Remove(item);
}

public sealed class TargetsRepository(NutriPlanDbContext db) : ITargetsRepository
{
    public async Task<NutritionTargets> GetAsync(CancellationToken ct = default)
    {
        var targets = await db.Targets.FirstOrDefaultAsync(t => t.Id == NutritionTargets.SingletonId, ct);
        if (targets is not null) return targets;
        targets = new NutritionTargets();
        db.Targets.Add(targets);
        await db.SaveChangesAsync(ct);
        return targets;
    }
}
