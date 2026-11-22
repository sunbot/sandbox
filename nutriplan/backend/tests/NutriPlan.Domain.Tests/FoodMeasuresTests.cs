using NutriPlan.Domain.Foods;
using NutriPlan.Domain.Nutrients;
using NutriPlan.Domain.Units;

namespace NutriPlan.Domain.Tests;

/// <summary>The measures a food can be logged in come only from its own data or exact unit conversions.</summary>
public class FoodMeasuresTests
{
    private static Food F(string name, params FoodPortion[] portions) =>
        new(name, FoodSource.UsdaSrLegacy, new NutrientProfile(new Dictionary<int, double> { [NutrientIds.Energy] = 100 }), portions: portions);

    private static Food Drink(string name, params FoodPortion[] portions) =>
        new(name, FoodSource.UsdaBranded, new NutrientProfile(new Dictionary<int, double> { [NutrientIds.Energy] = 60 }), portions: portions, basis: NutrientBasis.Volume);

    private static Food Almonds() => F("Nuts, almonds", new FoodPortion("cup, whole", 143), new FoodPortion("oz (23 whole kernels)", 28.35), new FoodPortion("almond", 1.2));

    [Fact]
    public void Almonds_offer_a_count_household_volumes_from_the_measured_cup_and_exact_weights()
    {
        var m = FoodMeasures.For(Almonds());
        Assert.Equal(["almond", "cup", "tbsp", "tsp", "g", "oz"], m.Select(x => x.Unit));
        var almond = m.Single(x => x.Unit == "almond");
        Assert.Equal(1.2, almond.BasePerUnit, 3);
        Assert.Equal("almonds", almond.Plural);
        Assert.Equal(MeasureKind.Count, almond.Kind);
        Assert.Equal(143.0 / 16, m.Single(x => x.Unit == "tbsp").BasePerUnit, 2); // from USDA's cup of almonds
        Assert.Equal("cup, whole", m.Single(x => x.Unit == "tbsp").Source);
        Assert.Equal(28.349523, m.Single(x => x.Unit == "oz").BasePerUnit, 4);
        Assert.Null(m.Single(x => x.Unit == "g").Source);
        Assert.DoesNotContain(m, x => x.Unit == "fl oz");
    }

    [Fact]
    public void Every_offered_measure_resolves_to_the_same_weight_on_the_server()
    {
        foreach (var food in new[] { Almonds(), F("Egg, whole, raw", new FoodPortion("large", 50), new FoodPortion("medium", 44), new FoodPortion("extra large", 56), new FoodPortion("cup (4.86 large eggs)", 243)),
                     F("Yogurt, Greek, plain", new FoodPortion("container (6 oz)", 170), new FoodPortion("cup (8 fl oz)", 245)),
                     F("Bananas, raw", new FoodPortion("medium (7\" to 7-7/8\" long)", 118), new FoodPortion("cup, sliced", 150)) })
            foreach (var m in FoodMeasures.For(food))
                Assert.Equal(m.BasePerUnit, QuantityResolver.Resolve(food, 1, m.Unit).Grams!.Value, 3);
    }

    [Fact]
    public void Natural_labels_replace_USDA_descriptions_which_are_kept_as_the_source()
    {
        var yogurt = FoodMeasures.For(F("Yogurt, Greek, plain", new FoodPortion("container (6 oz)", 170)));
        var container = yogurt.Single(x => x.Kind == MeasureKind.Count);
        Assert.Equal(("container", "containers", "container (6 oz)"), (container.Label, container.Plural, container.Source));

        var banana = FoodMeasures.For(F("Bananas, raw", new FoodPortion("medium (7\" to 7-7/8\" long)", 118)));
        Assert.Equal("medium", banana.Single(x => x.Kind == MeasureKind.Count).Label);

        var whey = FoodMeasures.For(F("Whey protein powder", new FoodPortion("scoop", 31)));
        Assert.Equal(("scoop", "scoops", 31.0), (whey[0].Unit, whey[0].Plural, whey[0].BasePerUnit));
    }

    [Fact]
    public void A_solid_food_without_a_measured_volume_offers_no_cups_or_spoons()
    {
        var m = FoodMeasures.For(F("Chicken breast, roasted", new FoodPortion("breast, bone and skin removed", 172)));
        Assert.DoesNotContain(m, x => x.Kind == MeasureKind.Volume);
        Assert.Contains(m, x => x.Unit == "g");
        Assert.Contains(m, x => x.Unit == "breast");
    }

    [Fact]
    public void A_drink_measured_per_100_ml_offers_exact_volumes_and_never_grams()
    {
        var m = FoodMeasures.For(Drink("Protein shake", new FoodPortion("bottle", 340)));
        Assert.Contains(m, x => x.Unit == "bottle" && x.BasePerUnit == 340);
        Assert.Equal(236.588, m.Single(x => x.Unit == "cup").BasePerUnit, 3);
        Assert.Contains(m, x => x.Unit == "fl oz");
        Assert.Contains(m, x => x.Unit == "ml");
        Assert.DoesNotContain(m, x => x.Kind == MeasureKind.Mass);
    }

    [Fact]
    public void A_food_with_no_portions_can_still_be_weighed()
    {
        Assert.Equal(["g", "oz"], FoodMeasures.For(F("Mystery granola")).Select(x => x.Unit));
    }

    [Theory]
    [InlineData("almond", "almonds")]
    [InlineData("large", "large")]
    [InlineData("slice", "slices")]
    [InlineData("patty", "patties")]
    [InlineData("peach", "peaches")]
    [InlineData("container", "containers")]
    public void Plurals_read_naturally(string word, string plural) => Assert.Equal(plural, FoodMeasures.PluralOf(word));

    [Fact]
    public void An_existing_unit_is_matched_to_its_measure()
    {
        var m = FoodMeasures.For(Almonds());
        Assert.Equal("almond", FoodMeasures.Match(m, "almonds")!.Unit);
        Assert.Equal("oz", FoodMeasures.Match(m, "ounces")!.Unit);
        Assert.Equal("g", FoodMeasures.Match(m, "grams")!.Unit);
        Assert.Null(FoodMeasures.Match(m, "slice"));
    }
}
