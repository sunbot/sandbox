using NutriPlan.Application.Abstractions;
using NutriPlan.Application.Foods;
using NutriPlan.Domain.Diary;
using NutriPlan.Domain.Foods;
using NutriPlan.Domain.Nutrients;
using NutriPlan.Domain.Grocery;
using NutriPlan.Domain.Pantry;
using NutriPlan.Domain.Planning;
using NutriPlan.Domain.Recipes;

namespace NutriPlan.Application.Tests;

/// <summary>In-memory implementations of the persistence ports so services can be tested without a database.</summary>
public sealed class InMemoryStore : IFoodRepository, IRecipeRepository, IDiaryRepository, IPlanRepository, IPantryRepository, IGroceryExclusionRepository, ITargetsRepository, IUnitOfWork, IClock
{
    public List<Food> Foods { get; } = [];
    public List<Recipe> Recipes { get; } = [];
    public List<DiaryEntry> Diary { get; } = [];
    public List<PlanEntry> Plan { get; } = [];
    public List<PantryItem> Pantry { get; } = [];
    public List<GroceryExclusion> GroceryExclusions { get; } = [];
    public NutritionTargets Targets { get; } = new();
    public DateOnly Today { get; set; } = new(2026, 11, 18); // a Wednesday
    public DateTimeOffset Now => new(Today.ToDateTime(new TimeOnly(12, 0)), TimeSpan.Zero);
    public int Saves { get; private set; }

    public Task SaveChangesAsync(CancellationToken ct = default) { Saves++; return Task.CompletedTask; }

    // Foods
    Task<Food?> IFoodRepository.GetAsync(Guid id, CancellationToken ct) => Task.FromResult(Foods.FirstOrDefault(f => f.Id == id));
    Task<IReadOnlyDictionary<Guid, Food>> IFoodRepository.GetManyAsync(IEnumerable<Guid> ids, CancellationToken ct) =>
        Task.FromResult<IReadOnlyDictionary<Guid, Food>>(Foods.Where(f => ids.Contains(f.Id)).ToDictionary(f => f.Id));
    public Task<Food?> FindByBarcodeAsync(string barcode, CancellationToken ct = default) => Task.FromResult(Foods.FirstOrDefault(f => f.Barcode == barcode));
    public Task<Food?> FindBySourceAsync(FoodSource source, string sourceId, CancellationToken ct = default) =>
        Task.FromResult(Foods.FirstOrDefault(f => f.Source == source && f.SourceId == sourceId));
    public Task<IReadOnlyList<FoodSearchRow>> SearchAsync(string query, int limit, CancellationToken ct = default)
    {
        var tokens = FoodRanker.Tokens(query).ToList();
        IReadOnlyList<FoodSearchRow> rows = Foods
            .Where(f => tokens.Any(t => f.Name.Contains(t, StringComparison.OrdinalIgnoreCase)))
            .Select(f => new FoodSearchRow(f, 0.5, Diary.Count(d => d.Item.FoodId == f.Id)))
            .Take(limit).ToList();
        return Task.FromResult(rows);
    }
    void IFoodRepository.Add(Food food) => Foods.Add(food);

    // Recipes
    Task<Recipe?> IRecipeRepository.GetAsync(Guid id, CancellationToken ct) => Task.FromResult(Recipes.FirstOrDefault(r => r.Id == id));
    Task<IReadOnlyDictionary<Guid, Recipe>> IRecipeRepository.GetManyAsync(IEnumerable<Guid> ids, CancellationToken ct) =>
        Task.FromResult<IReadOnlyDictionary<Guid, Recipe>>(Recipes.Where(r => ids.Contains(r.Id)).ToDictionary(r => r.Id));
    public Task<Recipe?> FindByExternalIdAsync(RecipeOrigin origin, string externalId, CancellationToken ct = default) =>
        Task.FromResult(Recipes.FirstOrDefault(r => r.Origin == origin && r.ExternalId == externalId));
    public Task<IReadOnlyList<Recipe>> ListAsync(string? search = null, string? category = null, CancellationToken ct = default) =>
        Task.FromResult<IReadOnlyList<Recipe>>(Recipes.Where(r => search is null || r.Name.Contains(search, StringComparison.OrdinalIgnoreCase)).ToList());
    public Task<IReadOnlyList<RecipeLink>> LinksAsync(CancellationToken ct = default) =>
        Task.FromResult<IReadOnlyList<RecipeLink>>(Recipes.Select(r => new RecipeLink(r.Id, r.Name, r.SubRecipeIds.ToList())).ToList());
    void IRecipeRepository.Add(Recipe recipe) => Recipes.Add(recipe);
    void IRecipeRepository.Remove(Recipe recipe) => Recipes.Remove(recipe);

    // Diary
    Task<DiaryEntry?> IDiaryRepository.GetAsync(Guid id, CancellationToken ct) => Task.FromResult(Diary.FirstOrDefault(d => d.Id == id));
    Task<IReadOnlyList<DiaryEntry>> IDiaryRepository.GetRangeAsync(DateOnly from, DateOnly to, CancellationToken ct) =>
        Task.FromResult<IReadOnlyList<DiaryEntry>>(Diary.Where(d => d.Date >= from && d.Date <= to).ToList());
    public Task<IReadOnlySet<Guid>> GetLinkedPlanEntryIdsAsync(IReadOnlyCollection<Guid> planEntryIds, CancellationToken ct = default) =>
        Task.FromResult<IReadOnlySet<Guid>>(Diary.Where(d => d.PlanEntryId != null && planEntryIds.Contains(d.PlanEntryId.Value)).Select(d => d.PlanEntryId!.Value).ToHashSet());
    public Task<IReadOnlyList<FrequentItem>> GetFrequentItemsAsync(int days, int limit, CancellationToken ct = default) =>
        Task.FromResult<IReadOnlyList<FrequentItem>>(Diary.GroupBy(d => (d.Item.FoodId, d.Item.RecipeId))
            .Select(g => new FrequentItem(g.Last().Item, g.First().Meal, g.Count(), g.Last().LoggedAt)).Take(limit).ToList());
    void IDiaryRepository.Add(DiaryEntry entry) => Diary.Add(entry);
    void IDiaryRepository.Remove(DiaryEntry entry) => Diary.Remove(entry);

    // Plan
    Task<PlanEntry?> IPlanRepository.GetAsync(Guid id, CancellationToken ct) => Task.FromResult(Plan.FirstOrDefault(p => p.Id == id));
    Task<IReadOnlyList<PlanEntry>> IPlanRepository.GetRangeAsync(DateOnly from, DateOnly to, CancellationToken ct) =>
        Task.FromResult<IReadOnlyList<PlanEntry>>(Plan.Where(p => p.Date >= from && p.Date <= to).ToList());
    public Task<IReadOnlyList<PlanEntry>> GetBatchAsync(Guid batchId, CancellationToken ct = default) =>
        Task.FromResult<IReadOnlyList<PlanEntry>>(Plan.Where(p => p.BatchId == batchId).ToList());
    void IPlanRepository.Add(PlanEntry entry) => Plan.Add(entry);
    void IPlanRepository.Remove(PlanEntry entry) => Plan.Remove(entry);

    // Pantry
    Task<PantryItem?> IPantryRepository.GetAsync(Guid id, CancellationToken ct) => Task.FromResult(Pantry.FirstOrDefault(p => p.Id == id));
    Task<IReadOnlyList<PantryItem>> IPantryRepository.ListAsync(CancellationToken ct) => Task.FromResult<IReadOnlyList<PantryItem>>(Pantry.ToList());
    void IPantryRepository.Add(PantryItem item) => Pantry.Add(item);
    void IPantryRepository.Remove(PantryItem item) => Pantry.Remove(item);

    // Grocery exclusions
    Task<IReadOnlyList<GroceryExclusion>> IGroceryExclusionRepository.ListAsync(CancellationToken ct) => Task.FromResult<IReadOnlyList<GroceryExclusion>>(GroceryExclusions.ToList());
    void IGroceryExclusionRepository.Add(GroceryExclusion exclusion) => GroceryExclusions.Add(exclusion);
    void IGroceryExclusionRepository.Remove(GroceryExclusion exclusion) => GroceryExclusions.Remove(exclusion);

    // Targets
    Task<NutritionTargets> ITargetsRepository.GetAsync(CancellationToken ct) => Task.FromResult(Targets);

    public Food AddFood(string name, double kcal, double protein, double carbs, double fat, FoodSource source = FoodSource.UsdaSrLegacy, params FoodPortion[] portions)
    {
        var food = new Food(name, source, new NutrientProfile(new Dictionary<int, double>
        {
            [NutrientIds.Energy] = kcal, [NutrientIds.Protein] = protein, [NutrientIds.Carbohydrate] = carbs, [NutrientIds.Fat] = fat,
        }), portions: portions);
        Foods.Add(food);
        return food;
    }
}
