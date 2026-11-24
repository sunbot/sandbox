using NutriPlan.Application.Abstractions;
using NutriPlan.Application.Common;
using NutriPlan.Domain.Diary;
using NutriPlan.Domain.Planning;
using NutriPlan.Domain.Nutrients;
using NutriPlan.Domain.Units;

namespace NutriPlan.Application.Diary;

public sealed record DiaryEntryDto(Guid Id, DateOnly Date, string Meal, ItemDto Item, Guid? PlanEntryId, string? Note, DateTimeOffset LoggedAt)
{
    public static DiaryEntryDto From(DiaryEntry e) =>
        new(e.Id, e.Date, e.Meal.ToString(), ItemDto.From(e.Item), e.PlanEntryId, e.Note, e.LoggedAt);
}

public sealed record MealDto(string Meal, NutritionDto Totals, IReadOnlyList<DiaryEntryDto> Entries);

/// <param name="MissingFrom">How many of the day's entries have no value for this nutrient (unknown, not zero), so the
/// amount is a minimum. 0 means every entry reported it.</param>
public sealed record NutrientProgressDto(int NutrientId, string Name, string Unit, double Amount, double? Target, double? Percent, string Kind, int MissingFrom = 0);

public sealed record DayDto(
    DateOnly Date,
    NutritionDto Totals,
    IReadOnlyList<MealDto> Meals,
    IReadOnlyList<NutrientProgressDto> Progress);

/// <summary>Add a food by grams, or by amount + unit ("2 cups", "1 large").</summary>
public sealed record LogFoodRequest(DateOnly Date, MealSlot Meal, Guid FoodId, double? Grams, double? Amount, string? Unit, Guid? PlanEntryId = null);

public sealed record FoodAmount(Guid FoodId, double? Grams, double? Amount, string? Unit);

/// <summary>Several foods for one meal (Ask's "Log all"): every item is saved, or none is.</summary>
public sealed record LogFoodsRequest(DateOnly Date, MealSlot Meal, IReadOnlyList<FoodAmount> Items);

public sealed record ClearMealRequest(DateOnly Date, MealSlot Meal, IReadOnlyList<Guid> EntryIds);

/// <summary>Log a recipe: <c>Servings</c>, or <c>Amount</c> in <c>Unit</c> (one of the recipe's measures: servings, or g/cups when its finished weight/volume is set).</summary>
public sealed record LogRecipeRequest(DateOnly Date, MealSlot Meal, Guid RecipeId, double Servings, Guid? PlanEntryId = null, double? Amount = null, string? Unit = null);

public sealed record LogQuickRequest(DateOnly Date, MealSlot Meal, string Name, double Calories, double? Protein, double? Carbs, double? Fat);

public sealed record MoveDiaryEntriesRequest(DateOnly Date, IReadOnlyList<Guid>? EntryIds, MealSlot Meal);

/// <summary>Delete selected entries of one date (any meals): every entry is removed, or none is.</summary>
public sealed record DeleteDiaryEntriesRequest(DateOnly Date, IReadOnlyList<Guid>? EntryIds);

public sealed record QuickLogItemDto(ItemDto Item, string UsualMeal, int TimesLogged, DateTimeOffset LastLogged);

/// <summary>
/// Turns foods/recipes into diary entries (with a nutrition snapshot) and builds day views.
/// Also the backbone of quick-logging: recents, frequents, copy meal/day.
/// </summary>
public sealed class DiaryService(
    IDiaryRepository diary,
    IFoodRepository foods,
    IRecipeRepository recipes,
    ITargetsRepository targetsRepo,
    IUnitOfWork uow,
    IPlanRepository plans)
{
    public async Task<ItemSnapshot> BuildFoodItemAsync(Guid foodId, double? grams, double? amount, string? unit, CancellationToken ct)
    {
        var food = await foods.GetAsync(foodId, ct) ?? throw new NotFoundException($"Food {foodId} not found.");
        if (grams is null)
        {
            if (amount is null) throw new ValidationException("Provide grams or an amount.");
            var resolved = QuantityResolver.Resolve(food, amount.Value, unit);
            grams = resolved.Grams ?? throw new ValidationException(resolved.Explanation);
        }
        if (grams <= 0) throw new ValidationException("Amount must be greater than zero.");
        ItemAmounts.CheckBase(grams.Value, food.IsVolume);
        // A volume food's base amount ("grams" in the request) is millilitres.
        if (food.IsVolume)
            return ItemSnapshot.ForVolumeFood(food.Id, food.DisplayName, grams.Value, food.NutrientsFor(grams.Value),
                amount ?? grams, amount is null ? "ml" : unit ?? "serving");
        return ItemSnapshot.ForFood(food.Id, food.DisplayName, grams.Value, food.NutrientsFor(grams.Value),
            amount ?? grams, amount is null ? "g" : unit ?? "serving");
    }

    /// <summary>A recipe item: <paramref name="amount"/> servings, or <paramref name="amount"/> <paramref name="unit"/> in one of the recipe's measures.</summary>
    public async Task<ItemSnapshot> BuildRecipeItemAsync(Guid recipeId, double amount, CancellationToken ct, string? unit = null)
    {
        if (!double.IsFinite(amount) || amount <= 0) throw new ValidationException("Servings must be greater than zero.");
        var recipe = await recipes.GetAsync(recipeId, ct) ?? throw new NotFoundException($"Recipe {recipeId} not found.");
        return ItemAmounts.RecipeItem(recipe, amount, unit);
    }

    public async Task<DiaryEntryDto> LogFoodAsync(LogFoodRequest r, CancellationToken ct = default)
    {
        await RequireOwnPlanEntryAsync(r.PlanEntryId, ct);
        var item = await BuildFoodItemAsync(r.FoodId, r.Grams, r.Amount, r.Unit, ct);
        return await AddAsync(new DiaryEntry(r.Date, r.Meal, item, r.PlanEntryId), ct);
    }

    /// <summary>
    /// Logs several foods in one go. Every item is checked (food exists, amount converts) before anything is saved,
    /// and all entries are saved together, so a bad item never leaves half a meal in your diary.
    /// </summary>
    public async Task<IReadOnlyList<DiaryEntryDto>> LogFoodsAsync(LogFoodsRequest r, CancellationToken ct = default)
    {
        var items = await BuildFoodItemsAsync(r.Items, ct);
        var entries = items.Select(i => new DiaryEntry(r.Date, r.Meal, i)).ToList();
        entries.ForEach(diary.Add);
        await uow.SaveChangesAsync(ct);
        return entries.Select(DiaryEntryDto.From).ToList();
    }

    /// <summary>Validates and builds every item first; throws (naming the item) before anything is written.</summary>
    public async Task<IReadOnlyList<ItemSnapshot>> BuildFoodItemsAsync(IReadOnlyList<FoodAmount> items, CancellationToken ct)
    {
        if (items is null || items.Count == 0) throw new ValidationException("Add at least one food.");
        if (items.Count > 30) throw new ValidationException("That's more than 30 foods at once. Split it into meals.");
        var built = new List<ItemSnapshot>(items.Count);
        for (var i = 0; i < items.Count; i++)
        {
            try { built.Add(await BuildFoodItemAsync(items[i].FoodId, items[i].Grams, items[i].Amount, items[i].Unit, ct)); }
            catch (Exception ex) when (ex is ValidationException or NotFoundException)
            {
                throw new ValidationException($"Item {i + 1}: {ex.Message} Nothing was saved.");
            }
        }
        return built;
    }

    public async Task<DiaryEntryDto> LogRecipeAsync(LogRecipeRequest r, CancellationToken ct = default)
    {
        await RequireOwnPlanEntryAsync(r.PlanEntryId, ct);
        var item = await BuildRecipeItemAsync(r.RecipeId, r.Amount ?? r.Servings, ct, r.Amount is null ? null : r.Unit);
        return await AddAsync(new DiaryEntry(r.Date, r.Meal, item, r.PlanEntryId), ct);
    }

    /// <summary>A log may point at a planned meal only if it's one of yours (the plan repository is scoped to you).</summary>
    private async Task RequireOwnPlanEntryAsync(Guid? planEntryId, CancellationToken ct)
    {
        if (planEntryId is { } id && await plans.GetAsync(id, ct) is null) throw new NotFoundException($"Planned meal {id} not found.");
    }

    public Task<DiaryEntryDto> LogQuickAsync(LogQuickRequest r, CancellationToken ct = default) =>
        AddAsync(new DiaryEntry(r.Date, r.Meal, ItemSnapshot.QuickCalories(r.Name, r.Calories, r.Protein, r.Carbs, r.Fat)), ct);

    /// <summary>Re-logs a previous entry (quick log "again", or from the recents list) on a new date/meal.</summary>
    public async Task<DiaryEntryDto> RelogAsync(Guid entryId, DateOnly date, MealSlot? meal, CancellationToken ct = default)
    {
        var source = await diary.GetAsync(entryId, ct) ?? throw new NotFoundException($"Entry {entryId} not found.");
        return await AddAsync(new DiaryEntry(date, meal ?? source.Meal, source.Item), ct);
    }

    /// <summary>Copies a whole meal (or every meal when <paramref name="meal"/> is null) from one day to another.</summary>
    public async Task<IReadOnlyList<DiaryEntryDto>> CopyAsync(DateOnly from, DateOnly to, MealSlot? meal, MealSlot? toMeal, CancellationToken ct = default)
    {
        var entries = (await diary.GetRangeAsync(from, from, ct)).Where(e => meal is null || e.Meal == meal).ToList();
        var copies = entries.Select(e => new DiaryEntry(to, toMeal ?? e.Meal, e.Item)).ToList();
        copies.ForEach(diary.Add);
        await uow.SaveChangesAsync(ct);
        return copies.Select(DiaryEntryDto.From).ToList();
    }

    public async Task<DiaryEntryDto> UpdateAsync(Guid id, double? scale, DateOnly? date, MealSlot? meal, string? note, CancellationToken ct = default,
        double? amount = null, string? unit = null, double? grams = null)
    {
        var entry = await diary.GetAsync(id, ct) ?? throw new NotFoundException($"Entry {id} not found.");
        if (amount is null && (unit is not null || grams is not null)) throw new ValidationException("Send the amount with its unit.");
        if (amount is not null)
        {
            if (scale is not null) throw new ValidationException("Send an amount or a scale, not both.");
            entry.Replace(await ItemAmounts.ChangeAsync(entry.Item, amount.Value, unit, foods, ct, grams, recipes));
        }
        else if (scale is not null)
        {
            if (scale <= 0) throw new ValidationException("Scale must be greater than zero.");
            entry.Rescale(scale.Value);
        }
        if (date is not null || meal is not null) entry.Move(date ?? entry.Date, meal ?? entry.Meal);
        if (note is not null) entry.Note = note.Length == 0 ? null : note;
        await uow.SaveChangesAsync(ct);
        return DiaryEntryDto.From(entry);
    }

    /// <summary>Moves a bounded set of entries from one date in one save, without changing their item snapshots.</summary>
    public async Task<IReadOnlyList<DiaryEntryDto>> MoveManyAsync(MoveDiaryEntriesRequest r, CancellationToken ct = default)
    {
        if (r.EntryIds is null || r.EntryIds.Count == 0) throw new ValidationException("Select at least one diary entry.");
        if (r.EntryIds.Count > 100) throw new ValidationException("Move no more than 100 diary entries at once.");
        if (r.EntryIds.Distinct().Count() != r.EntryIds.Count) throw new ValidationException("Each diary entry can only be selected once.");
        if (!Enum.IsDefined(r.Meal)) throw new ValidationException("Choose a valid meal.");

        var requested = r.EntryIds.ToHashSet();
        var entries = (await diary.GetRangeAsync(r.Date, r.Date, ct)).Where(e => requested.Contains(e.Id)).ToList();
        if (entries.Count != requested.Count) throw new NotFoundException("One or more diary entries were not found for that date.");

        foreach (var entry in entries) entry.Move(r.Date, r.Meal);
        await uow.SaveChangesAsync(ct);
        var byId = entries.ToDictionary(e => e.Id);
        return r.EntryIds.Select(id => DiaryEntryDto.From(byId[id])).ToList();
    }

    /// <summary>The same item in a new amount and/or measure (see <see cref="ItemAmounts"/>); used for logged and planned items.</summary>
    public Task<ItemSnapshot> ChangeAmountAsync(ItemSnapshot item, double amount, string? unit, CancellationToken ct = default, double? grams = null) =>
        ItemAmounts.ChangeAsync(item, amount, unit, foods, ct, grams, recipes);

    public async Task DeleteAsync(Guid id, CancellationToken ct = default)
    {
        var entry = await diary.GetAsync(id, ct) ?? throw new NotFoundException($"Entry {id} not found.");
        diary.Remove(entry);
        // Un-logging a planned meal puts it back on the plan, so it isn't left marked eaten with no diary entry.
        if (entry.PlanEntryId is { } planId && await plans.GetAsync(planId, ct) is { Status: PlanStatus.Eaten } planned)
            planned.Reopen();
        await uow.SaveChangesAsync(ct);
    }

    public async Task ClearMealAsync(ClearMealRequest r, CancellationToken ct = default)
    {
        if (!Enum.IsDefined(r.Meal) || r.EntryIds is null || r.EntryIds.Count == 0 || r.EntryIds.Distinct().Count() != r.EntryIds.Count)
            throw new ValidationException("Choose at least one valid entry.");

        var ids = r.EntryIds.ToHashSet();
        var entries = (await diary.GetRangeAsync(r.Date, r.Date, ct))
            .Where(e => e.Meal == r.Meal && ids.Contains(e.Id)).ToList();
        if (entries.Count != ids.Count)
            throw new ValidationException("The meal changed. Refresh and try again; nothing was deleted.");

        await RemoveAndSaveAsync(entries, ct);
    }

    /// <summary>Deletes a bounded set of selected entries from one date, across meals, in one save (all or nothing).</summary>
    public async Task DeleteManyAsync(DeleteDiaryEntriesRequest r, CancellationToken ct = default)
    {
        if (r.EntryIds is null || r.EntryIds.Count == 0) throw new ValidationException("Select at least one diary entry.");
        if (r.EntryIds.Count > 100) throw new ValidationException("Delete no more than 100 diary entries at once.");
        if (r.EntryIds.Distinct().Count() != r.EntryIds.Count) throw new ValidationException("Each diary entry can only be selected once.");

        var requested = r.EntryIds.ToHashSet();
        var entries = (await diary.GetRangeAsync(r.Date, r.Date, ct)).Where(e => requested.Contains(e.Id)).ToList();
        if (entries.Count != requested.Count) throw new NotFoundException("One or more diary entries were not found for that date; nothing was deleted.");
        await RemoveAndSaveAsync(entries, ct);
    }

    private async Task RemoveAndSaveAsync(IReadOnlyList<DiaryEntry> entries, CancellationToken ct)
    {
        foreach (var entry in entries)
        {
            diary.Remove(entry);
            // Un-logging a planned meal puts it back on the plan.
            if (entry.PlanEntryId is { } planId && await plans.GetAsync(planId, ct) is { Status: PlanStatus.Eaten } planned)
                planned.Reopen();
        }
        await uow.SaveChangesAsync(ct);
    }

    public async Task<DayDto> GetDayAsync(DateOnly date, CancellationToken ct = default)
    {
        var entries = await diary.GetRangeAsync(date, date, ct);
        var targets = await targetsRepo.GetAsync(ct);
        var totals = NutrientProfile.Sum(entries.Select(e => e.Item.Nutrients));

        var meals = Enum.GetValues<MealSlot>().Select(slot =>
        {
            var inMeal = entries.Where(e => e.Meal == slot).OrderBy(e => e.LoggedAt).ToList();
            return new MealDto(slot.ToString(), NutritionDto.From(NutrientProfile.Sum(inMeal.Select(e => e.Item.Nutrients))),
                inMeal.Select(DiaryEntryDto.From).ToList());
        }).ToList();

        var progressIds = new[] { NutrientIds.Energy, NutrientIds.Protein, NutrientIds.Carbohydrate, NutrientIds.Fat }
            .Concat(targets.EffectiveFocusNutrients)
            .Concat(NutrientCatalog.All.Where(n => n.DefaultTarget is not null).Select(n => n.Id))
            .Distinct();

        var progress = progressIds.Select(id =>
        {
            var def = NutrientCatalog.Get(id);
            var target = targets.TargetFor(id);
            var amount = totals.Get(id);
            // Unknown isn't zero: count entries that don't report this nutrient (quick calories, sparse labels).
            var missing = entries.Count(e => !e.Item.Nutrients.Has(id));
            return new NutrientProgressDto(id, def.Name, def.Unit, Math.Round(amount, 2), target,
                target is > 0 ? Math.Round(amount / target.Value * 100, 1) : null, def.TargetKind.ToString(), missing);
        }).ToList();

        return new DayDto(date, NutritionDto.From(totals), meals, progress);
    }

    /// <summary>Your usual foods for one-tap logging, optionally narrowed to a meal (breakfast regulars at breakfast).</summary>
    public async Task<IReadOnlyList<QuickLogItemDto>> GetQuickLogAsync(MealSlot? meal, int limit = 20, CancellationToken ct = default)
    {
        var frequent = await diary.GetFrequentItemsAsync(days: 60, limit: limit * 3, ct);
        return frequent
            .OrderByDescending(f => meal is not null && f.Meal == meal ? 1 : 0)
            .ThenByDescending(f => f.Count)
            .ThenByDescending(f => f.LastLogged)
            .Take(limit)
            .Select(f => new QuickLogItemDto(ItemDto.From(f.Item), f.Meal.ToString(), f.Count, f.LastLogged))
            .ToList();
    }

    private async Task<DiaryEntryDto> AddAsync(DiaryEntry entry, CancellationToken ct)
    {
        diary.Add(entry);
        await uow.SaveChangesAsync(ct);
        return DiaryEntryDto.From(entry);
    }
}
