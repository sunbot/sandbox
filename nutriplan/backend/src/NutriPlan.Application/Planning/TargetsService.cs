using NutriPlan.Application.Abstractions;
using NutriPlan.Application.Common;
using NutriPlan.Domain.Nutrients;
using NutriPlan.Domain.Planning;

namespace NutriPlan.Application.Planning;

public sealed record NutrientTargetDto(int NutrientId, string Name, string Unit, string Group, string Kind, double? Target, bool IsCustom, bool IsFocus);

public sealed record TargetsDto(
    double Calories, double ProteinGrams, double CarbGrams, double FatGrams,
    string BudgetMode, string WeekStartsOn, double MaxDailyAdjustment,
    IReadOnlyList<NutrientTargetDto> Nutrients);

public sealed record UpdateTargetsRequest(
    double? Calories, double? ProteinGrams, double? CarbGrams, double? FatGrams,
    BudgetMode? BudgetMode, DayOfWeek? WeekStartsOn, double? MaxDailyAdjustment,
    Dictionary<int, double?>? NutrientOverrides, List<int>? FocusNutrients);

public sealed class TargetsService(ITargetsRepository repo, IUnitOfWork uow)
{
    public async Task<TargetsDto> GetAsync(CancellationToken ct = default) => ToDto(await repo.GetAsync(ct));

    public async Task<TargetsDto> UpdateAsync(UpdateTargetsRequest r, CancellationToken ct = default)
    {
        var t = await repo.GetAsync(ct);
        if (r.Calories is { } kcal) t.Calories = Positive(kcal, "Calories");
        if (r.ProteinGrams is { } p) t.ProteinGrams = Positive(p, "Protein");
        if (r.CarbGrams is { } c) t.CarbGrams = Positive(c, "Carbs");
        if (r.FatGrams is { } f) t.FatGrams = Positive(f, "Fat");
        if (r.BudgetMode is { } mode) t.BudgetMode = mode;
        if (r.WeekStartsOn is { } day) t.WeekStartsOn = day;
        if (r.MaxDailyAdjustment is { } adj) t.MaxDailyAdjustment = Math.Clamp(adj, 0, 0.5);
        if (r.NutrientOverrides is not null)
        {
            var overrides = new Dictionary<int, double>(t.NutrientOverrides);
            foreach (var (id, value) in r.NutrientOverrides)
            {
                if (NutrientCatalog.Find(id) is null) throw new ValidationException($"Unknown nutrient {id}.");
                if (value is null) overrides.Remove(id); else overrides[id] = Positive(value.Value, NutrientCatalog.Get(id).Name);
            }
            t.NutrientOverrides = overrides; // new instance so EF sees the change
        }
        if (r.FocusNutrients is not null)
        {
            if (r.FocusNutrients.Any(id => NutrientCatalog.Find(id) is null)) throw new ValidationException("Unknown nutrient in focus list.");
            t.FocusNutrients = r.FocusNutrients.Distinct().ToList();
        }
        await uow.SaveChangesAsync(ct);
        return ToDto(t);
    }

    private static double Positive(double v, string name) => v > 0 ? v : throw new ValidationException($"{name} must be greater than zero.");

    private static TargetsDto ToDto(NutritionTargets t)
    {
        var focus = t.EffectiveFocusNutrients.ToHashSet();
        var nutrients = NutrientCatalog.All.OrderBy(n => n.DisplayOrder).Select(n => new NutrientTargetDto(
            n.Id, n.Name, n.Unit, n.Group.ToString(), n.TargetKind.ToString(), t.TargetFor(n.Id),
            t.NutrientOverrides.ContainsKey(n.Id), focus.Contains(n.Id))).ToList();
        return new TargetsDto(t.Calories, t.ProteinGrams, t.CarbGrams, t.FatGrams, t.BudgetMode.ToString(),
            t.WeekStartsOn.ToString(), t.MaxDailyAdjustment, nutrients);
    }
}
