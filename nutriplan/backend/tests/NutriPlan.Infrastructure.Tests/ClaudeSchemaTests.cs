using System.Reflection;
using System.Text.Json;
using NutriPlan.Infrastructure.Ai;

namespace NutriPlan.Infrastructure.Tests;

/// <summary>
/// Anthropic validates the structured-output schema and rejects it with a 400 for shapes it can't handle, such as
/// {"type": ["string","null"], "enum": [..., null]} ("Enum value 'raw' does not match declared type"). Nullable choices
/// must be written as anyOf [ {type, enum}, {type:null} ]. These tests catch a bad schema without needing a network call.
/// </summary>
public class ClaudeSchemaTests
{
    public static IEnumerable<object[]> Schemas()
    {
        foreach (var type in new[] { typeof(ClaudeInterpreter), typeof(ClaudeRecipeIdeaGenerator) })
        {
            var field = type.GetField("Schema", BindingFlags.NonPublic | BindingFlags.Static)
                ?? throw new InvalidOperationException($"{type.Name} has no Schema field.");
            yield return [type.Name, (IReadOnlyDictionary<string, JsonElement>)field.GetValue(null)!];
        }
    }

    private static IEnumerable<JsonElement> Walk(JsonElement e)
    {
        yield return e;
        if (e.ValueKind == JsonValueKind.Object) foreach (var p in e.EnumerateObject()) foreach (var c in Walk(p.Value)) yield return c;
        if (e.ValueKind == JsonValueKind.Array) foreach (var i in e.EnumerateArray()) foreach (var c in Walk(i)) yield return c;
    }

    [Theory]
    [MemberData(nameof(Schemas))]
    public void No_enum_is_combined_with_a_type_list(string name, IReadOnlyDictionary<string, JsonElement> schema)
    {
        var root = JsonSerializer.SerializeToElement(schema);
        foreach (var node in Walk(root).Where(n => n.ValueKind == JsonValueKind.Object))
        {
            var hasEnum = node.TryGetProperty("enum", out var values);
            if (!hasEnum) continue;
            // An enum must sit beside a single string type, and contain only strings (null goes in a sibling anyOf branch).
            if (node.TryGetProperty("type", out var type)) Assert.True(type.ValueKind == JsonValueKind.String, $"{name}: enum next to a type list: {node}");
            Assert.All(values.EnumerateArray(), v => Assert.Equal(JsonValueKind.String, v.ValueKind));
        }
    }

    [Fact]
    public void Nullable_choices_are_anyOf_with_a_null_branch()
    {
        var schema = (IReadOnlyDictionary<string, JsonElement>)Schemas().First()[1];
        var root = JsonSerializer.SerializeToElement(schema);
        var props = root.GetProperty("properties");
        Assert.Equal(2, props.GetProperty("meal").GetProperty("anyOf").GetArrayLength());
        var cooked = props.GetProperty("items").GetProperty("items").GetProperty("properties").GetProperty("cooked_state").GetProperty("anyOf");
        Assert.Contains(cooked.EnumerateArray(), b => b.GetProperty("type").GetString() == "null");
        Assert.Contains(cooked.EnumerateArray(), b => b.TryGetProperty("enum", out var e) && e.EnumerateArray().Any(x => x.GetString() == "raw"));
    }
}
