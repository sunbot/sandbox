using NutriPlan.Application.Foods;
using NutriPlan.Application.Planning;
using NutriPlan.Domain.Diary;
using NutriPlan.Domain.Foods;
using NutriPlan.Domain.Nutrients;
using NutriPlan.Domain.Pantry;
using NutriPlan.Domain.Planning;

namespace NutriPlan.Application.Tests;

/// <summary>"Show different ideas" through the real service: ids sent back are skipped, filters hold, planning recalculates.</summary>
public class GapRotationServiceTests
{
    private readonly InMemoryStore _store = new();
    private GapFillService Service() => new(_store, _store, _store, _store, _store, _store, new FoodService(_store, [], _store));
    private DateOnly Day => _store.Today;

    private Food AddFood(string name, double kcal, double protein, double fiber, string portion, double grams)
    {
        var food = new Food(name, FoodSource.UsdaSrLegacy, new NutrientProfile(new Dictionary<int, double>
        {
            [NutrientIds.Energy] = kcal, [NutrientIds.Protein] = protein, [NutrientIds.Fiber] = fiber, [NutrientIds.Sodium] = 40,
            [NutrientIds.Carbohydrate] = 10, [NutrientIds.Fat] = 2,
        }), portions: [new FoodPortion(portion, grams)]);
        _store.Foods.Add(food);
        for (var i = 1; i <= 3; i++)
            _store.Diary.Add(new DiaryEntry(Day.AddDays(-i), MealSlot.Snack, ItemSnapshot.ForFood(food.Id, food.Name, grams, food.NutrientsFor(grams))));
        return food;
    }

    private void Everyday()
    {
        AddFood("Yogurt, Greek, plain, nonfat", 59, 10, 0, "container", 170);
        AddFood("Almonds", 579, 21, 12.5, "oz", 28);
        AddFood("Bananas, raw", 89, 1.1, 2.6, "medium", 118);
        AddFood("Apples, raw, with skin", 52, 0.3, 2.4, "medium", 182);
        AddFood("Blueberries, raw", 57, 0.7, 2.4, "cup", 148);
        AddFood("Cheese, cottage, lowfat", 81, 10.5, 0, "cup", 226);
        AddFood("Egg, whole, cooked, hard-boiled", 155, 12.6, 0, "large", 50);
        AddFood("Chicken, broilers or fryers, breast, meat only, cooked, roasted", 165, 31, 0, "breast", 172);
        AddFood("Broccoli, cooked, boiled", 35, 2.4, 3.3, "cup", 156);
        AddFood("Rice, brown, cooked", 112, 2.3, 1.8, "cup", 195);
        AddFood("Lentils, mature seeds, cooked, boiled", 116, 9, 7.9, "cup", 198);
    }

    private async Task<List<GapReportDto>> PageThrough(GapMode mode = GapMode.BestMatch, int max = 40)
    {
        var shown = new List<string>();
        var pages = new List<GapReportDto>();
        for (var i = 0; i < max; i++)
        {
            var r = await Service().SuggestAsync(new GapFillRequest(Day, Mode: mode, Meal: MealSlot.Snack, Exclude: shown.ToList()));
            pages.Add(r);
            if (r.Suggestions.Count == 0) break;
            shown.AddRange(r.Suggestions.Select(s => s.Id));
        }
        return pages;
    }

    [Fact]
    public async Task Each_request_with_the_shown_ids_brings_new_ideas_until_none_are_left()
    {
        Everyday();
        var pages = await PageThrough();
        Assert.True(pages.Count >= 3);
        var ids = pages.SelectMany(p => p.Suggestions).Select(s => s.Id).ToList();
        Assert.All(ids, id => Assert.Matches("^[0-9a-f]{16}$", id));
        Assert.Equal(ids.Count, ids.Distinct().Count());
        Assert.True(pages[0].MoreIdeas > 0);

        var last = pages[^1];
        Assert.Empty(last.Suggestions);
        Assert.Equal("Exhausted", last.EmptyReason);
        Assert.Equal("No more matching ideas right now.", last.EmptyMessage);
        Assert.Equal(ids.Count, last.SkippedIdeas);
        Assert.Equal("Open", last.Situation); // the day still has room: only the ideas ran out

        // Starting over (no ids) gives the first page again: a new session.
        var fresh = await Service().SuggestAsync(new GapFillRequest(Day, Meal: MealSlot.Snack));
        Assert.Equal(pages[0].Suggestions.Select(s => s.Id), fresh.Suggestions.Select(s => s.Id));
    }

    [Fact]
    public async Task Pantry_filter_holds_while_rotating()
    {
        Everyday();
        foreach (var f in _store.Foods.Where(f => f.Name.StartsWith("Yogurt") || f.Name.StartsWith("Bananas") || f.Name.StartsWith("Almonds") || f.Name.StartsWith("Apples")))
            _store.Pantry.Add(new PantryItem(f.Name, f.Id, null));
        var pantryIds = _store.Pantry.Select(p => p.FoodId).ToHashSet();
        var pages = await PageThrough(GapMode.Pantry);
        Assert.All(pages, p => Assert.Equal("Pantry", p.Mode));
        Assert.All(pages.SelectMany(p => p.Suggestions).SelectMany(s => s.Items), i => Assert.Contains(i.FoodId, pantryIds));
    }

    [Fact]
    public async Task Planning_an_idea_recalculates_what_is_left_and_it_is_not_suggested_again()
    {
        Everyday();
        var before = await Service().SuggestAsync(new GapFillRequest(Day));
        var pick = before.Suggestions[0];
        foreach (var it in pick.Items)
        {
            var food = _store.Foods.Single(f => f.Id == it.FoodId);
            _store.Plan.Add(new PlanEntry(Day, MealSlot.Snack, ItemSnapshot.ForFood(food.Id, food.Name, it.Amount, food.NutrientsFor(it.Amount))));
        }

        var after = await Service().SuggestAsync(new GapFillRequest(Day, Exclude: before.Suggestions.Skip(1).Select(s => s.Id).ToList()));
        Assert.Equal(before.Remaining.Calories - pick.Adds.Calories, after.Remaining.Calories, 0);
        var plannedFoods = pick.Items.Select(i => i.FoodId).ToHashSet();
        Assert.DoesNotContain(after.Suggestions.SelectMany(s => s.Items), i => plannedFoods.Contains(i.FoodId)); // already on today
        Assert.DoesNotContain(after.Suggestions, s => before.Suggestions.Select(b => b.Id).Contains(s.Id));
    }

    [Fact]
    public async Task Malformed_or_unknown_ids_are_ignored_not_trusted()
    {
        Everyday();
        var normal = await Service().SuggestAsync(new GapFillRequest(Day));
        var junk = await Service().SuggestAsync(new GapFillRequest(Day, Exclude: ["", "nope", "f:almonds", new string('a', 500), "0123456789abcdef"]));
        Assert.Equal(normal.Suggestions.Select(s => s.Id), junk.Suggestions.Select(s => s.Id));
        Assert.Equal(0, junk.SkippedIdeas);
    }

    [Fact]
    public void Ideas_come_only_from_the_database_and_rules_with_no_language_model_or_paid_service()
    {
        var parameters = typeof(GapFillService).GetConstructors().Single().GetParameters().Select(p => p.ParameterType).ToList();
        Assert.DoesNotContain(parameters, t => t == typeof(Abstractions.ILanguageInterpreter) || t.Name.Contains("Claude") || t.Name.Contains("Branded") || t.Name.Contains("Http"));
    }
}
