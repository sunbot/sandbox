using NutriPlan.Application.Recipes;
using NutriPlan.Domain.Recipes;

namespace NutriPlan.Application.Tests;

/// <summary>#84: searching "apple" showed a chili with no visible reason. Results now say what they matched on, name first.</summary>
public class RecipeSearchTests
{
    private static Recipe R(string name, string[] lines, string? description = null, string[]? categories = null)
    {
        var r = new Recipe(name, 4);
        r.SetIngredientLines(lines);
        r.Description = description;
        if (categories is not null) r.SetCategories(categories);
        return r;
    }

    private readonly Recipe _chili = R("Smoky Chipotle Beef Chili", ["1 lb ground beef", "1 tbsp apple cider vinegar", "2 chipotles in adobo"], "A weeknight chili.");
    private readonly Recipe _crumble = R("Apple crumble", ["4 apples", "1 cup oats"]);
    private readonly Recipe _salad = R("Fall salad", ["greens"], categories: ["Apple season"]);
    private readonly Recipe _soup = R("Tomato soup", ["tomatoes"], "Goes with an apple on the side.");

    [Fact]
    public void Name_matches_come_first_and_others_say_what_they_matched()
    {
        var hits = RecipeSearch.Filter([_chili, _soup, _salad, _crumble], "apple");
        Assert.Equal(["Apple crumble", "Fall salad", "Smoky Chipotle Beef Chili", "Tomato soup"], hits.Select(h => h.Recipe.Name));
        Assert.Equal(RecipeMatchField.Name, hits[0].Hit.Field);
        Assert.Equal((RecipeMatchField.Category, "Apple season"), (hits[1].Hit.Field, hits[1].Hit.Text));
        Assert.Equal((RecipeMatchField.Ingredient, "1 tbsp apple cider vinegar"), (hits[2].Hit.Field, hits[2].Hit.Text));
        Assert.Equal(RecipeMatchField.Description, hits[3].Hit.Field);
    }

    [Fact]
    public void Every_word_must_match_somewhere_and_unrelated_recipes_are_excluded()
    {
        Assert.Empty(RecipeSearch.Filter([_chili], "banana"));
        Assert.Equal(RecipeMatchField.Name, RecipeSearch.Match(_chili, "beef chili")!.Field);
        Assert.Equal(RecipeMatchField.Ingredient, RecipeSearch.Match(_chili, "chili vinegar")!.Field); // weakest field labels it
        Assert.Null(RecipeSearch.Match(_chili, "chili banana"));
    }

    [Fact]
    public async Task The_api_list_carries_the_match_reason_only_when_it_is_not_the_name()
    {
        var store = new InMemoryStore();
        store.Recipes.AddRange([_chili, _crumble]);
        var svc = new RecipeService(store, store, new Foods.FoodService(store, [], store), null!, store);
        var list = await svc.ListAsync("apple", null);
        Assert.Equal("Apple crumble", list[0].Name);
        Assert.Null(list[0].MatchedOn);
        Assert.Equal(("Ingredient", "1 tbsp apple cider vinegar"), (list[1].MatchedOn, list[1].MatchedText));
    }
}
