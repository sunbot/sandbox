using System.Globalization;
using System.Text.Json;
using Anthropic.Models.Beta.Messages;
using Microsoft.Extensions.Options;
using NutriPlan.Application.Abstractions;
using NutriPlan.Domain.Diary;

namespace NutriPlan.Infrastructure.Ai;

/// <summary>
/// Turns chat/voice text into a structured request. The model is told never to produce nutrition
/// numbers — it only identifies foods and amounts, which are then looked up in the database.
/// </summary>
public sealed class ClaudeInterpreter(ClaudeJsonClient claude, IOptions<ClaudeOptions> options) : ILanguageInterpreter
{
    public bool IsAvailable => claude.IsConfigured;

    private const string System = """
        You turn short food-tracking messages (often voice transcriptions) into structured data for a nutrition app.
        The app looks foods up in the USDA database itself, so you must NEVER state calories or nutrient amounts.

        Choose the intent:
        - log_food: the user says they ate/drank something ("I had…", "for lunch …", "log …").
        - find_food: they just name a food/amount to look up ("half a pound of chicken breast").
        - find_recipes: they want recipe ideas ("Christmas cookie recipes", "high protein dinners").
        - what_can_i_make: they ask what they can cook from what they have.
        - fill_gaps: they ask what to eat to hit their targets / round out the day.
        - plan_meal: they want to put something on a future day's plan.
        - unknown: anything else (put a short helpful sentence in reply).

        For each food item:
        - food_query: a concise database search phrase, generic first, e.g. "chicken breast", "greek yogurt plain nonfat",
          "bread whole wheat", "coffee brewed". Split mixed meals into separate items when they're clearly separate
          ("eggs and toast" = 2 items). Keep dishes whole when they're one thing ("chicken caesar salad", "lasagna").
        - amount and unit: as stated. Use standard units where the user did (g, oz, lb, cup, tbsp, tsp, ml, fl oz)
          or count words ("large", "slice", "piece", "medium"). "Half a pound" = amount 0.5, unit "lb".
          If no amount is given, use null. For vague amounts (handful, splash, bowl) give your best estimate in a
          standard unit (a handful of almonds ≈ 1 oz) and mention the assumption in reply.
        - cooked_state: "raw" or "cooked" only when it changes the numbers (meat, fish, grains, pasta, beans, potatoes)
          AND the user said or clearly implied it ("grilled chicken" = cooked). Otherwise null.
        - brand: only if the user named one.
        - preparation: short note like "scrambled" or "with skin", else null.

        meal: breakfast/lunch/dinner/snack if mentioned or obvious, else null.
        date: ISO date (YYYY-MM-DD) if they said yesterday/tomorrow/a weekday, relative to today's date given below, else null.
        recipe_query / recipe_count: for find_recipes only (e.g. "christmas cookies", 5).
        reply: one short friendly sentence only when something needs saying (an assumption you made), else null.
        """;

    private static readonly IReadOnlyDictionary<string, JsonElement> Schema = JsonSchema.Parse("""
        {
          "type": "object",
          "additionalProperties": false,
          "required": ["intent", "items", "meal", "date", "recipe_query", "recipe_count", "reply"],
          "properties": {
            "intent": { "type": "string", "enum": ["log_food", "find_food", "find_recipes", "what_can_i_make", "fill_gaps", "plan_meal", "unknown"] },
            "items": {
              "type": "array",
              "items": {
                "type": "object",
                "additionalProperties": false,
                "required": ["food_query", "amount", "unit", "preparation", "brand", "cooked_state"],
                "properties": {
                  "food_query": { "type": "string" },
                  "amount": { "type": ["number", "null"] },
                  "unit": { "type": ["string", "null"] },
                  "preparation": { "type": ["string", "null"] },
                  "brand": { "type": ["string", "null"] },
                  "cooked_state": { "anyOf": [ { "type": "string", "enum": ["raw", "cooked"] }, { "type": "null" } ] }
                }
              }
            },
            "meal": { "anyOf": [ { "type": "string", "enum": ["breakfast", "lunch", "dinner", "snack"] }, { "type": "null" } ] },
            "date": { "type": ["string", "null"] },
            "recipe_query": { "type": ["string", "null"] },
            "recipe_count": { "type": ["integer", "null"] },
            "reply": { "type": ["string", "null"] }
          }
        }
        """);

    public async Task<InterpretedRequest> InterpretAsync(string text, DateOnly today, CancellationToken ct = default)
    {
        var user = $"Today is {today:dddd yyyy-MM-dd}.\nMessage: {text}";
        using var doc = await claude.CompleteJsonAsync(options.Value.InterpreterModel, System, user, Schema, Effort.Low, 4096, ct);
        return Map(doc.RootElement);
    }

    public static InterpretedRequest Map(JsonElement root)
    {
        var intent = Str(root, "intent") switch
        {
            "log_food" => AssistantIntent.LogFood,
            "find_food" => AssistantIntent.FindFood,
            "find_recipes" => AssistantIntent.FindRecipes,
            "what_can_i_make" => AssistantIntent.WhatCanIMake,
            "fill_gaps" => AssistantIntent.FillGaps,
            "plan_meal" => AssistantIntent.PlanMeal,
            _ => AssistantIntent.Unknown,
        };

        var items = new List<InterpretedItem>();
        if (root.TryGetProperty("items", out var arr) && arr.ValueKind == JsonValueKind.Array)
        {
            foreach (var i in arr.EnumerateArray())
            {
                var query = Str(i, "food_query");
                if (string.IsNullOrWhiteSpace(query)) continue;
                items.Add(new InterpretedItem(query.Trim(), Num(i, "amount"), Str(i, "unit"), Str(i, "preparation"), Str(i, "brand"), Str(i, "cooked_state")));
            }
        }

        MealSlot? meal = Str(root, "meal") switch
        {
            "breakfast" => MealSlot.Breakfast,
            "lunch" => MealSlot.Lunch,
            "dinner" => MealSlot.Dinner,
            "snack" => MealSlot.Snack,
            _ => null,
        };

        DateOnly? date = DateOnly.TryParseExact(Str(root, "date"), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d) ? d : null;
        int? count = root.TryGetProperty("recipe_count", out var c) && c.ValueKind == JsonValueKind.Number ? c.GetInt32() : null;

        return new InterpretedRequest(intent, items, meal, date, Str(root, "recipe_query"), count, Str(root, "reply"));
    }

    private static string? Str(JsonElement e, string name) =>
        e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static double? Num(JsonElement e, string name) =>
        e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetDouble() : null;
}

internal static class JsonSchema
{
    public static IReadOnlyDictionary<string, JsonElement> Parse(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.EnumerateObject().ToDictionary(p => p.Name, p => p.Value.Clone());
    }
}
