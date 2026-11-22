using NutriPlan.Domain.Foods;
using NutriPlan.Domain.Nutrients;
using NutriPlan.Domain.Units;

namespace NutriPlan.Domain.Tests;

/// <summary>
/// USDA portion names shown as measures ("100-calorie package", never "calorie"), and portions borrowed from the SR Legacy
/// food USDA links a Foundation food to — only when it's shown to be the same physical food and the portion fits its form.
/// </summary>
public class UsdaMeasureLabelTests
{
    private static Food F(string name, FoodSource source, params FoodPortion[] portions) =>
        new(name, source, new NutrientProfile(new Dictionary<int, double> { [NutrientIds.Energy] = 598 }), portions: portions);

    /// <summary>"Almonds, NFS" as USDA's Survey (FNDDS) data has it.</summary>
    private static Food AlmondsNfs() => F("Almonds, NFS", FoodSource.UsdaSurvey,
        new FoodPortion("100 calorie package", 18), new FoodPortion("nut", 1.2), new FoodPortion("package", 50), new FoodPortion("oz", 28.35), new FoodPortion("cup", 141));

    /// <summary>SR Legacy "Nuts, almonds" (NDB 12061) portions.</summary>
    private static readonly FoodPortion[] SrAlmondPortions =
    [
        new("cup, whole", 143), new("cup, sliced", 92), new("cup, slivered", 108), new("cup, ground", 95), new("oz (23 whole kernels)", 28.35), new("almond", 1.2),
    ];

    private const string Origin = "USDA SR Legacy “Nuts, almonds” (FDC 170567, same NDB 12061)";

    // ── Labels ─────────────────────────────────────────────────────────────────

    [Fact]
    public void A_number_qualified_portion_is_named_by_its_whole_phrase_not_a_calorie_unit()
    {
        var m = FoodMeasures.For(AlmondsNfs());
        Assert.DoesNotContain(m, x => x.Unit.Equals("calorie", StringComparison.OrdinalIgnoreCase) || x.Label.Equals("calorie", StringComparison.OrdinalIgnoreCase));
        var pack = m.Single(x => x.Unit == "100-calorie package");
        Assert.Equal("100-calorie package", pack.Label);
        Assert.Equal("100-calorie packages", pack.Plural);
        Assert.Equal(18, pack.BasePerUnit, 3);
        Assert.Equal("100 calorie package", pack.Source); // the USDA wording is kept for provenance
        Assert.Equal(50, m.Single(x => x.Unit == "package").BasePerUnit, 3); // the plain package is still its own measure
        Assert.Equal(1.2, m.Single(x => x.Unit == "nut").BasePerUnit, 3);
        Assert.Equal(["100-calorie package", "nut", "package", "cup", "tbsp", "tsp", "g", "oz"], m.Select(x => x.Unit));
    }

    [Fact]
    public void The_label_the_app_sends_resolves_to_the_same_portion_and_old_logs_still_resolve()
    {
        var food = AlmondsNfs();
        foreach (var unit in new[] { "100-calorie package", "100-calorie packages", "100 calorie package", "100-Calorie Package" })
        {
            var r = QuantityResolver.Resolve(food, 2, unit);
            Assert.Equal(ResolutionMethod.NamedPortion, r.Method);
            Assert.Equal(36, r.Grams!.Value, 6);
            Assert.Equal("100 calorie package", r.Portion!.Description);
        }
        // Entries logged before this change stored "calorie": unchanged weight, never the 50 g package.
        Assert.Equal(18, QuantityResolver.Resolve(food, 1, "calorie").Grams!.Value, 6);
        Assert.Equal(50, QuantityResolver.Resolve(food, 1, "package").Grams!.Value, 6);
    }

    [Fact]
    public void Distinct_number_qualified_portions_stay_distinct_with_their_own_weights()
    {
        var pretzels = F("Pretzels, hard, plain, salted", FoodSource.UsdaSrLegacy,
            new FoodPortion("1-3 ring thin pretzel", 3), new FoodPortion("1-3 ring thick pretzel", 6), new FoodPortion("100-calorie package (3 cakes)", 26));
        var m = FoodMeasures.For(pretzels);
        Assert.Equal(3, m.Single(x => x.Unit == "1-3 ring thin pretzel").BasePerUnit, 3);
        Assert.Equal(6, m.Single(x => x.Unit == "1-3 ring thick pretzel").BasePerUnit, 3);
        Assert.Equal("1-3 ring thick pretzels", m.Single(x => x.Unit == "1-3 ring thick pretzel").Plural);
        Assert.Equal(26, m.Single(x => x.Unit == "100-calorie package").BasePerUnit, 3);
        Assert.DoesNotContain(m, x => x.Unit is "ring" or "calorie");
        foreach (var x in m) Assert.Equal(x.BasePerUnit, QuantityResolver.Resolve(pretzels, 1, x.Unit).Grams!.Value, 3);
    }

    [Fact]
    public void A_number_followed_by_a_unit_or_size_keeps_the_noun_as_the_measure()
    {
        var yogurt = F("Yogurt, plain", FoodSource.UsdaSurvey, new FoodPortion("6 oz container", 170), new FoodPortion("cup", 245));
        Assert.Equal(170, FoodMeasures.For(yogurt).Single(x => x.Unit == "container").BasePerUnit, 3);
        var pancakes = F("Pancakes, plain", FoodSource.UsdaSurvey, new FoodPortion("1-inch stack", 40));
        Assert.Equal("stacks", FoodMeasures.For(pancakes).Single(x => x.Unit == "stack").Plural);
        var cookie = F("Cookies, sugar", FoodSource.UsdaSrLegacy, new FoodPortion("2-1/4\" dia (include Snickerdoodles)", 15));
        Assert.DoesNotContain(FoodMeasures.For(cookie), x => x.Kind == MeasureKind.Count); // nothing that names a measure
    }

    [Fact]
    public void Same_named_portions_with_different_weights_are_not_offered_under_that_name()
    {
        var food = F("Snack mix", FoodSource.UsdaSurvey, new FoodPortion("100 calorie package", 18), new FoodPortion("100 calorie package", 22), new FoodPortion("cup", 60));
        Assert.DoesNotContain(FoodMeasures.For(food), x => x.Unit.Contains("calorie"));
        Assert.False(QuantityResolver.Resolve(food, 1, "100-calorie package").IsResolved);
    }

    [Fact]
    public void A_weight_portion_is_never_offered_as_an_item()
    {
        var seeds = F("Pumpkin seeds, NFS", FoodSource.UsdaSurvey,
            new FoodPortion("cup, NFS", 46), new FoodPortion("package", 50), new FoodPortion("cup, without shell", 144), new FoodPortion("oz, NFS", 28.35), new FoodPortion("oz, without shell", 28.35));
        var m = FoodMeasures.For(seeds);
        Assert.DoesNotContain(m, x => x.Unit is "nfs" or "shell");
        Assert.Equal(["package", "cup", "tbsp", "tsp", "g", "oz"], m.Select(x => x.Unit));
        var patties = F("Beef, patties", FoodSource.UsdaSrLegacy, new FoodPortion("oz grilled patties", 28.35), new FoodPortion("lb, boneless", 453.6));
        Assert.DoesNotContain(FoodMeasures.For(patties), x => x.Kind == MeasureKind.Count);
    }

    [Theory]
    [InlineData("100-calorie package", "100-calorie packages")]
    [InlineData("1-3 ring thin pretzel", "1-3 ring thin pretzels")]
    [InlineData("2-cookie serving", "2-cookie servings")]
    [InlineData("berry", "berries")]
    [InlineData("large", "large")]
    public void Phrases_pluralize_their_last_word(string label, string plural) => Assert.Equal(plural, FoodMeasures.PluralOfPhrase(label));

    // ── Borrowing portions from the linked SR Legacy food ────────────────────────

    [Fact]
    public void Whole_raw_almonds_borrow_only_the_whole_almond_portions_with_their_origin()
    {
        var borrowed = EquivalentPortions.Borrowable("Nuts, almonds, whole, raw", "Nuts, almonds", SrAlmondPortions, Origin);
        Assert.Equal(["cup, whole", "oz (23 whole kernels)", "almond"], borrowed.Select(p => p.Description));
        Assert.All(borrowed, p => Assert.Equal(Origin, p.Origin));
        Assert.Equal(SrAlmondPortions.Where(p => borrowed.Any(b => b.Description == p.Description)).Select(p => p.GramWeight), borrowed.Select(p => p.GramWeight)); // weights unchanged

        var food = F("Nuts, almonds, whole, raw", FoodSource.UsdaFoundation);
        food.ReplacePortions(borrowed);
        var m = FoodMeasures.For(food);
        var almond = m.Single(x => x.Unit == "almond");
        Assert.Equal(1.2, almond.BasePerUnit, 3);
        Assert.Equal(Origin, almond.Origin);
        Assert.Equal(143, m.Single(x => x.Unit == "cup").BasePerUnit, 3); // the whole-almond cup, never the 92 g sliced cup
        Assert.Equal(Origin, m.Single(x => x.Unit == "cup").Origin);
        Assert.Equal(12 * 1.2, QuantityResolver.Resolve(food, 12, "almonds").Grams!.Value, 6);
    }

    [Theory]
    [InlineData("Apples, honeycrisp, with skin, raw", "Apples, raw, golden delicious, with skin")] // another variety
    [InlineData("Mushroom, portabella", "Mushrooms, portabella, grilled")]                          // raw vs grilled
    [InlineData("Nuts, pine nuts, raw", "Nuts, pine nuts, dried")]                                  // raw vs dried
    [InlineData("Flaxseed, ground", "Seeds, flaxseed")]                                             // ground vs whole seeds
    [InlineData("Nuts, almonds, dry roasted, with salt added", "Nuts, almonds")]                    // roasted, salted vs raw
    [InlineData("Almonds, sliced", "Almonds")]                                                      // a cut the donor isn't
    [InlineData("Cabbage, green, raw", "Cabbage, raw")]                                             // not established: leave unavailable
    [InlineData("Peanuts, raw", "Peanuts, all types, raw")]
    public void Linked_records_that_are_not_shown_to_be_the_same_food_lend_nothing(string target, string donor)
    {
        Assert.False(EquivalentPortions.SameFood(target, donor));
        Assert.Empty(EquivalentPortions.Borrowable(target, donor, [new FoodPortion("cup", 100), new FoodPortion("piece", 5)], Origin));
    }

    [Fact]
    public void Halves_borrow_halves_portions_but_not_chopped_or_a_plain_cup()
    {
        var borrowed = EquivalentPortions.Borrowable("Nuts, walnuts, English, halves, raw", "Nuts, walnuts, english",
            [new FoodPortion("cup, chopped", 117), new FoodPortion("cup shelled (50 halves)", 100), new FoodPortion("oz (14 halves)", 28.35), new FoodPortion("cup", 120)], Origin);
        Assert.Equal(["cup shelled (50 halves)", "oz (14 halves)"], borrowed.Select(p => p.Description));
    }

    [Fact]
    public void A_food_named_for_its_cut_on_both_sides_takes_all_portions()
    {
        var borrowed = EquivalentPortions.Borrowable("Tomatoes, crushed, canned", "Tomatoes, crushed, canned", [new FoodPortion("cup", 242)], Origin);
        Assert.Single(borrowed);
        var strawberries = EquivalentPortions.Borrowable("Strawberries, raw", "Strawberries, raw",
            [new FoodPortion("cup, whole", 144), new FoodPortion("cup, sliced", 166), new FoodPortion("medium (1-1/4\" dia)", 12)], Origin);
        Assert.Equal(3, strawberries.Count); // same food, no cut named: every USDA measure of it applies, as on the SR record
    }

    [Fact]
    public void Duplicate_and_zero_weight_donor_portions_are_skipped()
    {
        var borrowed = EquivalentPortions.Borrowable("Garlic, raw", "Garlic, raw",
            [new FoodPortion("clove", 3), new FoodPortion("Clove", 3), new FoodPortion("tsp", 0)], Origin);
        Assert.Equal(["clove"], borrowed.Select(p => p.Description));
    }
}
