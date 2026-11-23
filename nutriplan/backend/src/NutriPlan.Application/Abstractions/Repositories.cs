using NutriPlan.Domain.Diary;
using NutriPlan.Domain.Foods;
using NutriPlan.Domain.Pantry;
using NutriPlan.Domain.Planning;
using NutriPlan.Domain.Recipes;

namespace NutriPlan.Application.Abstractions;

/// <summary>A raw text-search hit; ranking happens in <see cref="Foods.FoodRanker"/> so it can be unit tested.</summary>
public sealed record FoodSearchRow(Food Food, double TextSimilarity, int TimesLogged);

public interface IFoodRepository
{
    Task<Food?> GetAsync(Guid id, CancellationToken ct = default);
    Task<IReadOnlyDictionary<Guid, Food>> GetManyAsync(IEnumerable<Guid> ids, CancellationToken ct = default);
    Task<Food?> FindByBarcodeAsync(string normalizedBarcode, CancellationToken ct = default);
    Task<Food?> FindBySourceAsync(FoodSource source, string sourceId, CancellationToken ct = default);
    /// <summary>Returns up to <paramref name="limit"/> foods whose name loosely matches the query.</summary>
    Task<IReadOnlyList<FoodSearchRow>> SearchAsync(string query, int limit, CancellationToken ct = default);
    void Add(Food food);
}

/// <summary>How one recipe uses others (for loops, "Used in" and passing edits up).</summary>
public sealed record RecipeLink(Guid Id, string Name, IReadOnlyList<Guid> Uses);

public interface IRecipeRepository
{
    Task<Recipe?> GetAsync(Guid id, CancellationToken ct = default);
    Task<IReadOnlyDictionary<Guid, Recipe>> GetManyAsync(IEnumerable<Guid> ids, CancellationToken ct = default);
    Task<Recipe?> FindByExternalIdAsync(RecipeOrigin origin, string externalId, CancellationToken ct = default);
    Task<IReadOnlyList<Recipe>> ListAsync(string? search = null, string? category = null, CancellationToken ct = default);
    /// <summary>Every recipe's id, name and the recipes it uses as ingredients, without loading photos or details.</summary>
    Task<IReadOnlyList<RecipeLink>> LinksAsync(CancellationToken ct = default);
    void Add(Recipe recipe);
    void Remove(Recipe recipe);
}

public sealed record FrequentItem(ItemSnapshot Item, MealSlot Meal, int Count, DateTimeOffset LastLogged);

public interface IDiaryRepository
{
    Task<DiaryEntry?> GetAsync(Guid id, CancellationToken ct = default);
    Task<IReadOnlyList<DiaryEntry>> GetRangeAsync(DateOnly from, DateOnly to, CancellationToken ct = default);
    /// <summary>Which of these plan entries have a diary entry logged against them (wherever that entry's date is now).</summary>
    Task<IReadOnlySet<Guid>> GetLinkedPlanEntryIdsAsync(IReadOnlyCollection<Guid> planEntryIds, CancellationToken ct = default);
    /// <summary>Most-logged foods/recipes in the lookback window, for quick-log and gap-filling.</summary>
    Task<IReadOnlyList<FrequentItem>> GetFrequentItemsAsync(int days, int limit, CancellationToken ct = default);
    void Add(DiaryEntry entry);
    void Remove(DiaryEntry entry);
}

public interface IPlanRepository
{
    Task<PlanEntry?> GetAsync(Guid id, CancellationToken ct = default);
    Task<IReadOnlyList<PlanEntry>> GetRangeAsync(DateOnly from, DateOnly to, CancellationToken ct = default);
    Task<IReadOnlyList<PlanEntry>> GetBatchAsync(Guid batchId, CancellationToken ct = default);
    void Add(PlanEntry entry);
    void Remove(PlanEntry entry);
}

public interface IPantryRepository
{
    Task<PantryItem?> GetAsync(Guid id, CancellationToken ct = default);
    Task<IReadOnlyList<PantryItem>> ListAsync(CancellationToken ct = default);
    void Add(PantryItem item);
    void Remove(PantryItem item);
}

public interface ITargetsRepository
{
    /// <summary>Returns the stored targets, creating the defaults on first use.</summary>
    Task<NutritionTargets> GetAsync(CancellationToken ct = default);
}

public interface IUnitOfWork
{
    Task SaveChangesAsync(CancellationToken ct = default);
}

public interface IClock
{
    DateOnly Today { get; }
    DateTimeOffset Now { get; }
}
