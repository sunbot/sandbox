using NutriPlan.Domain.Foods;
using NutriPlan.Domain.Nutrients;
using NutriPlan.Domain.Units;

namespace NutriPlan.Domain.Tests;

public class FoodAndQuantityTests
{
    private static NutrientProfile Macros(double kcal, double p, double c, double f) => new(new Dictionary<int, double>
    {
        [NutrientIds.Energy] = kcal, [NutrientIds.Protein] = p, [NutrientIds.Carbohydrate] = c, [NutrientIds.Fat] = f,
    });

    private static Food Rice() => new("Rice, white, cooked", FoodSource.UsdaSrLegacy, Macros(130, 2.7, 28, 0.3),
        portions: [new FoodPortion("cup", 158), new FoodPortion("tbsp", 9.9)]);

    private static Food Egg() => new("Egg, whole, raw", FoodSource.UsdaSrLegacy, Macros(143, 12.6, 0.7, 9.5),
        portions: [new FoodPortion("large", 50), new FoodPortion("medium", 44), new FoodPortion("cup (4.86 large eggs)", 243)]);

    [Fact]
    public void Nutrients_scale_by_grams()
    {
        var n = Rice().NutrientsFor(200);
        Assert.Equal(260, n.Calories, 6);
        Assert.Equal(5.4, n.Protein, 6);
    }

    [Fact]
    public void Mass_units_convert_exactly()
    {
        var r = QuantityResolver.Resolve(Rice(), 0.5, "lb");
        Assert.Equal(226.796, r.Grams!.Value, 3);
        Assert.Equal(ResolutionMethod.Mass, r.Method);
    }

    [Fact]
    public void Volume_uses_the_foods_own_density()
    {
        var r = QuantityResolver.Resolve(Rice(), 2, "cups");
        Assert.Equal(316, r.Grams!.Value, 6);

        var half = QuantityResolver.Resolve(Rice(), 3, "tsp"); // 3 tsp = 1 tbsp
        Assert.Equal(9.9, half.Grams!.Value, 1);
    }

    [Fact]
    public void Named_and_default_portions()
    {
        Assert.Equal(100, QuantityResolver.Resolve(Egg(), 2, "large").Grams);
        Assert.Equal(88, QuantityResolver.Resolve(Egg(), 2, "medium").Grams);
        Assert.Equal(150, QuantityResolver.Resolve(Egg(), 3, null).Grams); // "3 eggs" → large
    }

    [Fact]
    public void Volume_without_density_is_unresolved_rather_than_guessed()
    {
        var food = new Food("Chicken breast, raw", FoodSource.UsdaFoundation, Macros(120, 22.5, 0, 2.6));
        var r = QuantityResolver.Resolve(food, 1, "cup");
        Assert.False(r.IsResolved);
        Assert.Equal(ResolutionMethod.Unresolved, r.Method);
    }

    [Fact]
    public void Barcodes_normalize_upc_to_ean13()
    {
        Assert.Equal("0737628064502", Food.NormalizeBarcode("737628064502"));
        Assert.Equal("0737628064502", Food.NormalizeBarcode("0 737628 06450 2"));
        Assert.Equal("4006381333931", Food.NormalizeBarcode("4006381333931"));
    }

    [Fact]
    public void Inconsistent_label_is_flagged()
    {
        // Claims 50 kcal but macros say ~400.
        var food = new Food("Suspicious bar", FoodSource.OpenFoodFacts, Macros(50, 20, 40, 18));
        Assert.Equal(DataQuality.Flagged, food.Quality);
        Assert.NotNull(food.QualityNote);
    }

    [Fact]
    public void Consistent_usda_food_stays_verified()
    {
        Assert.Equal(DataQuality.Verified, Rice().Quality);
    }

    [Fact]
    public void Profiles_add_and_keep_unknowns_out()
    {
        var a = new NutrientProfile(new Dictionary<int, double> { [NutrientIds.Energy] = 100, [NutrientIds.Iron] = 1 });
        var b = new NutrientProfile(new Dictionary<int, double> { [NutrientIds.Energy] = 50 });
        var sum = a + b;
        Assert.Equal(150, sum.Calories);
        Assert.Equal(1, sum[NutrientIds.Iron]);
        Assert.Null(sum[NutrientIds.VitaminC]);
    }

    [Fact]
    public void A_count_word_never_matches_a_volume_measure()
    {
        // "1 piece ginger" must not become "1 cup (1\" pieces)" (118 g): leave it for the user to confirm instead.
        var q = Units.QuantityResolver.Resolve([new FoodPortion("cup (1\" pieces)", 118), new FoodPortion("tsp", 2)], 1, "piece", "Burdock root, raw");
        Assert.False(q.IsResolved);
    }

    [Fact]
    public void One_item_is_the_whole_item_not_a_slice_or_variety()
    {
        var tomato = new[] { new FoodPortion("slice", 20), new FoodPortion("grape tomato", 8), new FoodPortion("whole", 125), new FoodPortion("cherry", 17) };
        Assert.Equal(125, Units.QuantityResolver.Resolve(tomato, 1, "medium", "Tomatoes, raw").Grams);
        Assert.Equal(250, Units.QuantityResolver.Resolve(tomato, 2, null, "Tomatoes, raw").Grams);
    }
}
