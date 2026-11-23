using NutriPlan.Domain.Recipes;

namespace NutriPlan.Domain.Tests;

public class RecipeGraphTests
{
    private static readonly Guid A = Guid.NewGuid(), B = Guid.NewGuid(), C = Guid.NewGuid(), D = Guid.NewGuid(), E = Guid.NewGuid();

    // A uses B and C; B uses D; C uses D; E stands alone.
    private static readonly Dictionary<Guid, IReadOnlyCollection<Guid>> Uses = new()
    {
        [A] = [B, C], [B] = [D], [C] = [D], [D] = [], [E] = [],
    };
    private static IEnumerable<Guid> UsesOf(Guid id) => Uses.GetValueOrDefault(id) ?? [];

    [Fact]
    public void Adding_a_recipe_that_already_contains_the_parent_is_a_loop()
    {
        Assert.True(RecipeGraph.WouldCreateCycle(D, A, UsesOf));  // A contains D, so D can't contain A
        Assert.True(RecipeGraph.WouldCreateCycle(B, B, UsesOf));  // itself
        Assert.False(RecipeGraph.WouldCreateCycle(A, D, UsesOf)); // already there indirectly: fine, no loop
        Assert.False(RecipeGraph.WouldCreateCycle(E, A, UsesOf));
        Assert.Equal([A, B, D], RecipeGraph.PathTo(A, D, UsesOf));
    }

    [Fact]
    public void Dependents_come_after_everything_they_use()
    {
        var order = RecipeGraph.DependentsInOrder([D], Uses);
        Assert.Equal(3, order.Count);
        Assert.Equal(A, order[^1]);                                // A uses both B and C, so it is last
        Assert.DoesNotContain(D, order);
        Assert.DoesNotContain(E, order);
        Assert.Empty(RecipeGraph.DependentsInOrder([A], Uses));    // nothing uses A
    }

    [Fact]
    public void A_loop_in_bad_data_never_hangs()
    {
        var loop = new Dictionary<Guid, IReadOnlyCollection<Guid>> { [A] = [B], [B] = [A] };
        Assert.Empty(RecipeGraph.DependentsInOrder([A], loop).Where(id => id != A && id != B));
        Assert.NotNull(RecipeGraph.PathTo(A, A, id => loop.GetValueOrDefault(id) ?? []));
    }
}

public class RecipeMeasuresTests
{
    [Fact]
    public void Servings_always_weight_and_volume_only_when_entered()
    {
        var r = new Recipe("Chili", 4);
        Assert.Equal(["serving"], RecipeMeasures.For(r).Select(m => m.Unit));
        Assert.False(RecipeMeasures.Resolve(r, 100, "g").IsResolved);
        Assert.False(RecipeMeasures.Resolve(r, 1, "cup").IsResolved);

        r.CookedWeightGrams = 1200;   // 300 g a serving
        r.FinishedVolumeMl = 946.35;  // 4 cups, 1 a serving
        var g = RecipeMeasures.Resolve(r, 150, "grams");
        Assert.Equal(0.5, g.Servings!.Value, 6);
        Assert.Equal(150, g.Grams!.Value, 6);
        Assert.Equal(2, RecipeMeasures.Resolve(r, 2, "cups").Servings!.Value, 2);
        Assert.Equal(1.5, RecipeMeasures.Resolve(r, 1.5, "servings").Servings!.Value, 6);
        Assert.Equal(1.5, RecipeMeasures.Resolve(r, 1.5, null).Servings!.Value, 6);
        Assert.False(RecipeMeasures.Resolve(r, 1, "slice").IsResolved);
        Assert.False(RecipeMeasures.Resolve(r, 0, "serving").IsResolved);
        Assert.Contains(RecipeMeasures.For(r), m => m.Unit == "oz");
    }
}
