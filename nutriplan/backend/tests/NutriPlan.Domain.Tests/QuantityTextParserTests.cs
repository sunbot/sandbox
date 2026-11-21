using NutriPlan.Domain.Parsing;

namespace NutriPlan.Domain.Tests;

public class QuantityTextParserTests
{
    [Theory]
    [InlineData("1 1/2 cups all-purpose flour", 1.5, "cups", "all-purpose flour")]
    [InlineData("1½ cups sugar", 1.5, "cups", "sugar")]
    [InlineData("½ tsp salt", 0.5, "tsp", "salt")]
    [InlineData("200g chicken breast", 200, "g", "chicken breast")]
    [InlineData("half a pound of chicken breast", 0.5, "pound", "chicken breast")]
    [InlineData("2 large eggs", 2, "large", "eggs")]
    [InlineData("3 cloves garlic", 3, "cloves", "garlic")]
    [InlineData("2-3 tbsp olive oil", 2.5, "tbsp", "olive oil")]
    [InlineData("a banana", 1, null, "banana")]
    [InlineData("one and a half cups milk", 1.5, "cups", "milk")]
    [InlineData("a dozen eggs", 12, null, "eggs")]
    [InlineData("8 fl oz orange juice", 8, "fl oz", "orange juice")]
    [InlineData("cup of coffee", 1, "cup", "coffee")]
    [InlineData("1-1/2 cups rice", 1.5, "cups", "rice")]
    // Copied-recipe formatting: list markers, numbered steps, markdown, amounts only in parentheses.
    [InlineData("- 1 lb 80/20 ground beef", 1, "lb", "80/20 ground beef")]
    [InlineData("• ½ cup fresh lime juice", 0.5, "cup", "fresh lime juice")]
    [InlineData("▢ 1/2 cup olive oil", 0.5, "cup", "olive oil")]
    [InlineData("☐ 2 large eggs", 2, "large", "eggs")]
    [InlineData("1. 1/4 cup chopped cilantro", 0.25, "cup", "chopped cilantro")]
    [InlineData("- 2 tsp garlic powder *(or 4 fresh cloves, minced)*", 2, "tsp", "garlic powder")]
    [InlineData("**1 cup** whole milk", 1, "cup", "whole milk")]
    [InlineData("- Olive oil (about 2 tbsp for searing)", 2, "tbsp", "Olive oil")]
    [InlineData("1.5 cups flour", 1.5, "cups", "flour")]
    public void Parses_amount_unit_and_food(string input, double amount, string? unit, string food)
    {
        var result = QuantityTextParser.Parse(input);
        Assert.NotNull(result.Amount);
        Assert.Equal(amount, result.Amount!.Value, 3);
        Assert.Equal(unit, result.Unit);
        Assert.Equal(food, result.FoodText);
    }

    [Fact]
    public void Can_sizes_in_parentheses_multiply_out()
    {
        var result = QuantityTextParser.Parse("2 (14.5 oz) cans diced tomatoes");
        Assert.Equal(29, result.Amount!.Value, 3);
        Assert.Equal("oz", result.Unit);
        Assert.Equal("diced tomatoes", result.FoodText);
    }

    [Fact]
    public void Preparation_after_comma_is_separated()
    {
        var result = QuantityTextParser.Parse("1 lb boneless skinless chicken thighs, cut into 1-inch pieces");
        Assert.Equal(1, result.Amount);
        Assert.Equal("lb", result.Unit);
        Assert.Equal("boneless skinless chicken thighs", result.FoodText);
        Assert.Equal("cut into 1-inch pieces", result.Preparation);
    }

    [Fact]
    public void To_taste_has_no_quantity()
    {
        var result = QuantityTextParser.Parse("salt and pepper to taste");
        Assert.Null(result.Amount);
        Assert.Equal("salt and pepper", result.FoodText);
        Assert.Contains("to taste", result.Preparation);
    }

    [Fact]
    public void Capital_T_is_tablespoon_and_lower_t_is_teaspoon()
    {
        Assert.Equal("T", QuantityTextParser.Parse("2 T butter").Unit);
        Assert.Equal("t", QuantityTextParser.Parse("2 t vanilla").Unit);
        Assert.Equal("tbsp", Units.Units.Find("T")!.Name);
        Assert.Equal("tsp", Units.Units.Find("t")!.Name);
    }

    [Fact]
    public void Splits_a_spoken_sentence_into_items()
    {
        var items = QuantityTextParser.SplitItems("I had 2 eggs, toast with butter and a black coffee");
        Assert.Equal(["2 eggs", "toast", "butter", "a black coffee"], items);
    }

    [Fact]
    public void Does_not_split_one_and_a_half()
    {
        var items = QuantityTextParser.SplitItems("one and a half cups oatmeal");
        Assert.Single(items);
    }
}
