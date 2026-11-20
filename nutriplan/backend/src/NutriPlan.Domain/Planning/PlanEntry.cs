using NutriPlan.Domain.Diary;

namespace NutriPlan.Domain.Planning;

public enum PlanStatus { Planned, Eaten, Skipped }

public sealed class PlanEntry
{
    private PlanEntry() { } // EF

    public PlanEntry(DateOnly date, MealSlot meal, ItemSnapshot item, Guid? batchId = null)
    {
        Id = Guid.NewGuid();
        Date = date;
        Meal = meal;
        Item = item;
        BatchId = batchId;
        Status = PlanStatus.Planned;
        CreatedAt = DateTimeOffset.UtcNow;
    }

    public Guid Id { get; private set; }
    public DateOnly Date { get; private set; }
    public MealSlot Meal { get; private set; }
    public ItemSnapshot Item { get; private set; } = null!;
    public PlanStatus Status { get; private set; }
    /// <summary>Groups leftovers: one cook, several planned portions across days.</summary>
    public Guid? BatchId { get; private set; }
    public DateTimeOffset CreatedAt { get; private set; }

    public void Move(DateOnly date, MealSlot meal) { Date = date; Meal = meal; }

    public void Swap(ItemSnapshot item) { Item = item; Status = PlanStatus.Planned; }

    public void Rescale(double factor) => Item = Item.WithScale(factor);

    public void MarkEaten() => Status = PlanStatus.Eaten;

    public void MarkSkipped() => Status = PlanStatus.Skipped;

    public void Reopen() => Status = PlanStatus.Planned;

    /// <summary>Creates the diary entry that fulfils this planned meal (optionally at a different amount).</summary>
    public DiaryEntry ToDiaryEntry(double scale = 1)
    {
        MarkEaten();
        return new DiaryEntry(Date, Meal, scale == 1 ? Item : Item.WithScale(scale), Id);
    }
}
