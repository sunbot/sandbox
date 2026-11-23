using NutriPlan.Application.Abstractions;
using NutriPlan.Application.Common;
using NutriPlan.Application.Diary;
using NutriPlan.Domain.Diary;
using NutriPlan.Domain.Nutrients;
using NutriPlan.Domain.Planning;

namespace NutriPlan.Application.Planning;

public sealed record PlanEntryDto(Guid Id, DateOnly Date, string Meal, ItemDto Item, string Status, Guid? BatchId)
{
    public static PlanEntryDto From(PlanEntry e) => new(e.Id, e.Date, e.Meal.ToString(), ItemDto.From(e.Item), e.Status.ToString(), e.BatchId);
}

public sealed record PlanDayDto(
    DateOnly Date,
    bool IsPast,
    bool IsToday,
    bool IsUntracked,
    double BaseCalorieTarget,
    double AdjustedCalorieTarget,
    NutritionDto Eaten,
    NutritionDto PlannedRemaining,
    NutritionDto Projected,
    IReadOnlyList<PlanEntryDto> Planned,
    IReadOnlyList<DiaryEntryDto> Logged);

public sealed record WeekDto(
    DateOnly WeekStart,
    DateOnly WeekEnd,
    string BudgetMode,
    double WeeklyCalorieTarget,
    double EatenSoFar,
    double ProjectedTotal,
    double UnabsorbedCarryover,
    NutritionDto DailyTargets,
    IReadOnlyList<PlanDayDto> Days);

public sealed record AddPlanFoodRequest(DateOnly Date, MealSlot Meal, Guid FoodId, double? Grams, double? Amount, string? Unit);

/// <summary>Several foods planned for one meal (Ask's "Plan all"): all are planned, or none.</summary>
public sealed record AddPlanFoodsRequest(DateOnly Date, MealSlot Meal, IReadOnlyList<Diary.FoodAmount> Items);

public sealed record AddPlanRecipeRequest(DateOnly Date, MealSlot Meal, Guid RecipeId, double Servings, double? Amount = null, string? Unit = null);

/// <summary>Cook once, eat several times: one portion per (date, meal) slot, all linked by a batch id.</summary>
public sealed record AddBatchRequest(Guid RecipeId, double ServingsPerPortion, IReadOnlyList<BatchSlot> Slots);

public sealed record BatchSlot(DateOnly Date, MealSlot Meal);

public sealed record RebalanceProposalDto(DateOnly Date, double AdjustedTarget, double PlannedCalories, double SuggestedScale, IReadOnlyList<PlanEntryDto> AffectedEntries);

public sealed class PlanService(
    IPlanRepository plan,
    IDiaryRepository diary,
    ITargetsRepository targetsRepo,
    DiaryService diaryService,
    IClock clock,
    IUnitOfWork uow)
{
    /// <param name="clientToday">The caller's local date. The week is judged against it (past / today / future), not the server's
    /// clock, so Week and Today agree wherever you are. Falls back to the server's configured time zone.</param>
    public async Task<WeekDto> GetWeekAsync(DateOnly anyDayInWeek, DateOnly? clientToday = null, CancellationToken ct = default)
    {
        var targets = await targetsRepo.GetAsync(ct);
        var start = WeeklyBudgetCalculator.WeekStartFor(anyDayInWeek, targets.WeekStartsOn);
        var end = start.AddDays(6);
        var planned = await PlanReconciliation.ReadRangeAsync(plan, diary, start, end, ct);
        var logged = await diary.GetRangeAsync(start, end, ct);
        var today = clientToday ?? clock.Today;

        var inputs = Enumerable.Range(0, 7).Select(i =>
        {
            var date = start.AddDays(i);
            return new DayBudgetInput(date,
                logged.Where(e => e.Date == date).Sum(e => e.Item.Nutrients.Calories),
                planned.Where(p => p.Date == date && p.Status == PlanStatus.Planned).Sum(p => p.Item.Nutrients.Calories));
        }).ToList();

        var budget = WeeklyBudgetCalculator.Calculate(targets, today, inputs);

        var days = budget.Days.Select(b =>
        {
            var dayPlan = planned.Where(p => p.Date == b.Date).OrderBy(p => p.Meal).ThenBy(p => p.CreatedAt).ToList();
            var dayLog = logged.Where(e => e.Date == b.Date).OrderBy(e => e.Meal).ThenBy(e => e.LoggedAt).ToList();
            var eaten = NutrientProfile.Sum(dayLog.Select(e => e.Item.Nutrients));
            var remaining = b.IsPast
                ? NutrientProfile.Empty
                : NutrientProfile.Sum(dayPlan.Where(p => p.Status == PlanStatus.Planned).Select(p => p.Item.Nutrients));
            return new PlanDayDto(b.Date, b.IsPast, b.IsToday, b.IsUntracked, b.BaseTarget, b.AdjustedTarget,
                NutritionDto.From(eaten), NutritionDto.From(remaining), NutritionDto.From(eaten + remaining),
                dayPlan.Select(PlanEntryDto.From).ToList(), dayLog.Select(DiaryEntryDto.From).ToList());
        }).ToList();

        return new WeekDto(start, end, targets.BudgetMode.ToString(), budget.WeeklyTarget, budget.ConsumedSoFar,
            budget.ProjectedTotal, budget.UnabsorbedCarryover, NutritionDto.From(targets.AsProfile()), days);
    }

    public async Task<PlanEntryDto> AddFoodAsync(AddPlanFoodRequest r, CancellationToken ct = default)
    {
        var item = await diaryService.BuildFoodItemAsync(r.FoodId, r.Grams, r.Amount, r.Unit, ct);
        return await AddAsync(new PlanEntry(r.Date, r.Meal, item), ct);
    }

    /// <summary>Plans several foods together; nothing is planned if any item is invalid. Planned food never counts as eaten.</summary>
    public async Task<IReadOnlyList<PlanEntryDto>> AddFoodsAsync(AddPlanFoodsRequest r, CancellationToken ct = default)
    {
        var items = await diaryService.BuildFoodItemsAsync(r.Items, ct);
        var entries = items.Select(i => new PlanEntry(r.Date, r.Meal, i)).ToList();
        entries.ForEach(plan.Add);
        await uow.SaveChangesAsync(ct);
        return entries.Select(PlanEntryDto.From).ToList();
    }

    public async Task<PlanEntryDto> AddRecipeAsync(AddPlanRecipeRequest r, CancellationToken ct = default)
    {
        var item = await diaryService.BuildRecipeItemAsync(r.RecipeId, r.Amount ?? r.Servings, ct, r.Amount is null ? null : r.Unit);
        return await AddAsync(new PlanEntry(r.Date, r.Meal, item), ct);
    }

    public async Task<IReadOnlyList<PlanEntryDto>> AddBatchAsync(AddBatchRequest r, CancellationToken ct = default)
    {
        if (r.Slots.Count == 0) throw new ValidationException("Choose at least one day for the batch.");
        var item = await diaryService.BuildRecipeItemAsync(r.RecipeId, r.ServingsPerPortion, ct);
        var batchId = Guid.NewGuid();
        var entries = r.Slots.Select(s => new PlanEntry(s.Date, s.Meal, item, batchId)).ToList();
        entries.ForEach(plan.Add);
        await uow.SaveChangesAsync(ct);
        return entries.Select(PlanEntryDto.From).ToList();
    }

    public async Task<PlanEntryDto> MoveAsync(Guid id, DateOnly date, MealSlot meal, CancellationToken ct = default)
    {
        var entry = await GetEntry(id, ct);
        entry.Move(date, meal);
        await uow.SaveChangesAsync(ct);
        return PlanEntryDto.From(entry);
    }

    public async Task<PlanEntryDto> SwapForRecipeAsync(Guid id, Guid recipeId, double servings, CancellationToken ct = default)
    {
        var entry = await GetEntry(id, ct);
        entry.Swap(await diaryService.BuildRecipeItemAsync(recipeId, servings, ct));
        await uow.SaveChangesAsync(ct);
        return PlanEntryDto.From(entry);
    }

    public async Task<PlanEntryDto> SwapForFoodAsync(Guid id, Guid foodId, double? grams, double? amount, string? unit, CancellationToken ct = default)
    {
        var entry = await GetEntry(id, ct);
        entry.Swap(await diaryService.BuildFoodItemAsync(foodId, grams, amount, unit, ct));
        await uow.SaveChangesAsync(ct);
        return PlanEntryDto.From(entry);
    }

    public async Task<PlanEntryDto> RescaleAsync(Guid id, double scale, CancellationToken ct = default)
    {
        if (scale <= 0) throw new ValidationException("Scale must be greater than zero.");
        var entry = await GetEntry(id, ct);
        entry.Rescale(scale);
        await uow.SaveChangesAsync(ct);
        return PlanEntryDto.From(entry);
    }

    /// <summary>Change a planned item's amount in any measure its food supports (see <see cref="Diary.ItemAmounts"/>).</summary>
    public async Task<PlanEntryDto> SetAmountAsync(Guid id, double amount, string? unit, CancellationToken ct = default, double? grams = null)
    {
        var entry = await GetEntry(id, ct);
        if (entry.Status != PlanStatus.Planned) throw new ValidationException("Only planned items can be changed. Edit the logged entry instead.");
        entry.ChangeAmount(await diaryService.ChangeAmountAsync(entry.Item, amount, unit, ct, grams));
        await uow.SaveChangesAsync(ct);
        return PlanEntryDto.From(entry);
    }

    public async Task DeleteAsync(Guid id, CancellationToken ct = default)
    {
        plan.Remove(await GetEntry(id, ct));
        await uow.SaveChangesAsync(ct);
    }

    /// <summary>"I ate it" — logs the planned meal (optionally a different amount) and marks it eaten.</summary>
    public async Task<DiaryEntryDto> MarkEatenAsync(Guid id, double scale = 1, DateOnly? clientToday = null, CancellationToken ct = default)
    {
        if (scale <= 0) throw new ValidationException("Scale must be greater than zero.");
        var entry = await GetEntry(id, ct);
        if (entry.Status == PlanStatus.Eaten) throw new ValidationException("This meal is already logged.");
        // Planned food is never counted as eaten ahead of time.
        // Judged by the caller's local date; without one, the server's date plus a day of slack so a time-zone difference never blocks a real meal.
        if (entry.Date > (clientToday ?? clock.Today.AddDays(1))) throw new ValidationException("That meal is planned for a later day. Log it on the day you eat it.");
        var logged = entry.ToDiaryEntry(scale);
        diary.Add(logged);
        await uow.SaveChangesAsync(ct);
        return DiaryEntryDto.From(logged);
    }

    /// <summary>Undo a skip: the meal is planned again. (A logged meal is un-logged by deleting its diary entry.)</summary>
    public async Task<PlanEntryDto> ReopenAsync(Guid id, CancellationToken ct = default)
    {
        var entry = await GetEntry(id, ct);
        if (entry.Status == PlanStatus.Eaten) throw new ValidationException("This meal is logged. Delete it from the diary to plan it again.");
        entry.Reopen();
        await uow.SaveChangesAsync(ct);
        return PlanEntryDto.From(entry);
    }

    /// <summary>
    /// Copies the still-planned meals of one day (or one meal) to another day, as new plan entries. Eaten and skipped
    /// entries aren't copied, and nothing is logged.
    /// </summary>
    public async Task<IReadOnlyList<PlanEntryDto>> CopyAsync(DateOnly from, DateOnly to, MealSlot? meal, CancellationToken ct = default)
    {
        if (from == to && meal is null) throw new ValidationException("Choose a different day to copy to.");
        var source = (await PlanReconciliation.ReadRangeAsync(plan, diary, from, from, ct))
            .Where(e => e.Status == PlanStatus.Planned && (meal is null || e.Meal == meal)).ToList();
        if (source.Count == 0) throw new ValidationException("There's nothing planned to copy.");
        var copies = source.Select(e => new PlanEntry(to, e.Meal, e.Item)).ToList();
        copies.ForEach(plan.Add);
        await uow.SaveChangesAsync(ct);
        return copies.Select(PlanEntryDto.From).ToList();
    }

    public async Task<PlanEntryDto> MarkSkippedAsync(Guid id, CancellationToken ct = default)
    {
        var entry = await GetEntry(id, ct);
        entry.MarkSkipped();
        await uow.SaveChangesAsync(ct);
        return PlanEntryDto.From(entry);
    }

    /// <summary>
    /// After straying: for each remaining day whose plan misses the (adjusted) calorie target by more
    /// than 5 %, propose one scale factor for that day's planned portions. Nothing changes until applied.
    /// </summary>
    public async Task<IReadOnlyList<RebalanceProposalDto>> ProposeRebalanceAsync(DateOnly anyDayInWeek, DateOnly? clientToday = null, CancellationToken ct = default)
    {
        var week = await GetWeekAsync(anyDayInWeek, clientToday, ct);
        var proposals = new List<RebalanceProposalDto>();
        foreach (var day in week.Days.Where(d => !d.IsPast))
        {
            var open = day.Planned.Where(p => p.Status == nameof(PlanStatus.Planned)).ToList();
            var plannedKcal = open.Sum(p => p.Item.Nutrition.Calories);
            if (plannedKcal <= 0) continue;
            var room = day.AdjustedCalorieTarget - day.Eaten.Calories;
            if (Math.Abs(room - plannedKcal) / day.AdjustedCalorieTarget < 0.05) continue;
            // Scaling only makes sense for a mostly-planned day; for a sparse day, the gap filler is the right tool.
            if (plannedKcal < room * 0.6) continue;
            var scale = Math.Clamp(Math.Round(room / plannedKcal, 2), 0.5, 1.5);
            proposals.Add(new RebalanceProposalDto(day.Date, day.AdjustedCalorieTarget, plannedKcal, scale, open));
        }
        return proposals;
    }

    public async Task<IReadOnlyList<PlanEntryDto>> ApplyRebalanceAsync(DateOnly date, double scale, CancellationToken ct = default)
    {
        if (scale <= 0) throw new ValidationException("Scale must be greater than zero.");
        var entries = (await PlanReconciliation.ReadRangeAsync(plan, diary, date, date, ct)).Where(e => e.Status == PlanStatus.Planned).ToList();
        entries.ForEach(e => e.Rescale(scale));
        await uow.SaveChangesAsync(ct);
        return entries.Select(PlanEntryDto.From).ToList();
    }

    private async Task<PlanEntry> GetEntry(Guid id, CancellationToken ct) =>
        await PlanReconciliation.ReadAsync(plan, diary, id, ct) ?? throw new NotFoundException($"Plan entry {id} not found.");

    private async Task<PlanEntryDto> AddAsync(PlanEntry entry, CancellationToken ct)
    {
        plan.Add(entry);
        await uow.SaveChangesAsync(ct);
        return PlanEntryDto.From(entry);
    }
}
