using System.Net;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace NutriPlan.Application.Recipes.Import;

/// <summary>
/// Extracts a schema.org/Recipe from a web page's JSON-LD (<c>&lt;script type="application/ld+json"&gt;</c>).
/// Nearly every recipe site publishes this for Google, so it's far more reliable than scraping HTML.
/// Handles @graph containers, arrays, @type arrays, HowToStep/HowToSection instructions and ISO-8601 durations.
/// </summary>
public static partial class JsonLdRecipeExtractor
{
    public static ImportedRecipe? Extract(string html, Uri? pageUrl = null)
    {
        foreach (Match m in LdJsonScript().Matches(html))
        {
            var json = WebUtility.HtmlDecode(m.Groups[1].Value).Trim();
            JsonDocument doc;
            try { doc = JsonDocument.Parse(json, new JsonDocumentOptions { AllowTrailingCommas = true, CommentHandling = JsonCommentHandling.Skip }); }
            catch (JsonException) { continue; }

            using (doc)
            {
                var recipe = FindRecipe(doc.RootElement);
                if (recipe is { } r) return Map(r, pageUrl);
            }
        }
        return null;
    }

    private static JsonElement? FindRecipe(JsonElement element)
    {
        switch (element.ValueKind)
        {
            case JsonValueKind.Array:
                foreach (var item in element.EnumerateArray())
                    if (FindRecipe(item) is { } found) return found;
                break;
            case JsonValueKind.Object:
                if (IsType(element, "Recipe")) return element;
                if (element.TryGetProperty("@graph", out var graph) && FindRecipe(graph) is { } g) return g;
                if (element.TryGetProperty("mainEntity", out var main) && FindRecipe(main) is { } me) return me;
                break;
        }
        return null;
    }

    private static bool IsType(JsonElement e, string type)
    {
        if (!e.TryGetProperty("@type", out var t)) return false;
        return t.ValueKind switch
        {
            JsonValueKind.String => string.Equals(t.GetString(), type, StringComparison.OrdinalIgnoreCase),
            JsonValueKind.Array => t.EnumerateArray().Any(x => string.Equals(x.GetString(), type, StringComparison.OrdinalIgnoreCase)),
            _ => false,
        };
    }

    private static ImportedRecipe Map(JsonElement r, Uri? pageUrl)
    {
        var yieldText = YieldText(r);
        var categories = Strings(r, "recipeCategory").Concat(Strings(r, "recipeCuisine"))
            .Concat(Strings(r, "keywords").SelectMany(k => k.Split(',')))
            .Select(s => s.Trim()).Where(s => s.Length is > 0 and < 40)
            .Distinct(StringComparer.OrdinalIgnoreCase).Take(12).ToList();

        return new ImportedRecipe
        {
            Name = Clean(Str(r, "name")) ?? "Untitled recipe",
            Description = Clean(Str(r, "description")),
            IngredientLines = Strings(r, "recipeIngredient").Concat(Strings(r, "ingredients")).Select(Clean).OfType<string>().ToList(),
            Directions = Instructions(r),
            ServingsText = yieldText,
            Servings = ServingsParser.Parse(yieldText),
            PrepTime = Duration(Str(r, "prepTime")),
            CookTime = Duration(Str(r, "cookTime")),
            TotalTime = Duration(Str(r, "totalTime")),
            ImageUrl = Image(r),
            SourceUrl = pageUrl?.ToString() ?? Str(r, "url"),
            SourceName = pageUrl?.Host.Replace("www.", "") ?? AuthorName(r),
            Categories = categories,
            SourceNutritionText = NutritionText(r),
        };
    }

    private static string? YieldText(JsonElement r)
    {
        if (!r.TryGetProperty("recipeYield", out var y)) return null;
        return y.ValueKind switch
        {
            JsonValueKind.Array => y.EnumerateArray().Select(ToText).FirstOrDefault(s => s is not null && s.Any(char.IsDigit))
                                   ?? y.EnumerateArray().Select(ToText).FirstOrDefault(),
            _ => ToText(y),
        };
    }

    private static string? Instructions(JsonElement r)
    {
        if (!r.TryGetProperty("recipeInstructions", out var ins)) return null;
        var steps = new List<string>();
        Collect(ins, steps);
        return steps.Count == 0 ? null : string.Join("\n", steps.Select((s, i) => s.StartsWith('#') ? s : $"{i + 1}. {s}"));

        static void Collect(JsonElement e, List<string> steps)
        {
            switch (e.ValueKind)
            {
                case JsonValueKind.String:
                    foreach (var line in StripTags(e.GetString()!).Split('\n').Select(l => l.Trim()).Where(l => l.Length > 0))
                        steps.Add(line);
                    break;
                case JsonValueKind.Array:
                    foreach (var item in e.EnumerateArray()) Collect(item, steps);
                    break;
                case JsonValueKind.Object:
                    if (IsType(e, "HowToSection"))
                    {
                        if (Str(e, "name") is { } name) steps.Add($"# {name}");
                        if (e.TryGetProperty("itemListElement", out var items)) Collect(items, steps);
                    }
                    else if (Str(e, "text") is { } text) steps.Add(StripTags(text).Trim());
                    else if (Str(e, "name") is { } n) steps.Add(n);
                    break;
            }
        }
    }

    private static string? Image(JsonElement r)
    {
        if (!r.TryGetProperty("image", out var img)) return null;
        return img.ValueKind switch
        {
            JsonValueKind.String => img.GetString(),
            JsonValueKind.Array => img.EnumerateArray().Select(i => i.ValueKind == JsonValueKind.String ? i.GetString() : Str(i, "url")).FirstOrDefault(s => s is not null),
            JsonValueKind.Object => Str(img, "url"),
            _ => null,
        };
    }

    private static string? AuthorName(JsonElement r)
    {
        if (!r.TryGetProperty("author", out var a)) return null;
        return a.ValueKind switch
        {
            JsonValueKind.String => a.GetString(),
            JsonValueKind.Object => Str(a, "name"),
            JsonValueKind.Array => a.EnumerateArray().Select(x => x.ValueKind == JsonValueKind.Object ? Str(x, "name") : x.GetString()).FirstOrDefault(),
            _ => null,
        };
    }

    private static string? NutritionText(JsonElement r)
    {
        if (!r.TryGetProperty("nutrition", out var n) || n.ValueKind != JsonValueKind.Object) return null;
        var parts = n.EnumerateObject()
            .Where(p => !p.Name.StartsWith('@') && p.Value.ValueKind is JsonValueKind.String or JsonValueKind.Number)
            .Select(p => $"{p.Name}: {ToText(p.Value)}");
        var text = string.Join("; ", parts);
        return text.Length == 0 ? null : text;
    }

    /// <summary>"PT1H30M" → "1 h 30 min".</summary>
    public static string? Duration(string? iso)
    {
        if (string.IsNullOrWhiteSpace(iso)) return null;
        var m = IsoDuration().Match(iso);
        if (!m.Success) return iso;
        var days = m.Groups["d"].Success ? int.Parse(m.Groups["d"].Value) : 0;
        var hours = (m.Groups["h"].Success ? int.Parse(m.Groups["h"].Value) : 0) + days * 24;
        var minutes = m.Groups["m"].Success ? int.Parse(m.Groups["m"].Value) : 0;
        hours += minutes / 60; minutes %= 60;
        if (hours == 0 && minutes == 0) return null;
        return hours > 0 ? minutes > 0 ? $"{hours} h {minutes} min" : $"{hours} h" : $"{minutes} min";
    }

    private static string? Str(JsonElement e, string name) =>
        e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) ? ToText(v) : null;

    private static IEnumerable<string> Strings(JsonElement e, string name)
    {
        if (e.ValueKind != JsonValueKind.Object || !e.TryGetProperty(name, out var v)) yield break;
        if (v.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in v.EnumerateArray())
                if (ToText(item) is { } s) yield return s;
        }
        else if (ToText(v) is { } single) yield return single;
    }

    private static string? ToText(JsonElement v) => v.ValueKind switch
    {
        JsonValueKind.String => v.GetString(),
        JsonValueKind.Number => v.GetRawText(),
        JsonValueKind.Object => Str(v, "name") ?? Str(v, "text"),
        _ => null,
    };

    private static string? Clean(string? s)
    {
        if (string.IsNullOrWhiteSpace(s)) return null;
        var text = WebUtility.HtmlDecode(StripTags(s));
        return MultiSpace().Replace(text, " ").Trim();
    }

    private static string StripTags(string s) => Tags().Replace(s.Replace("<br>", "\n").Replace("<br/>", "\n").Replace("<br />", "\n"), "");

    [GeneratedRegex(@"<script[^>]*type\s*=\s*[""']application/ld\+json[""'][^>]*>(.*?)</script>", RegexOptions.Singleline | RegexOptions.IgnoreCase)]
    private static partial Regex LdJsonScript();

    [GeneratedRegex(@"^P(?:(?<d>\d+)D)?(?:T(?:(?<h>\d+)H)?(?:(?<m>\d+)M)?(?:\d+(?:\.\d+)?S)?)?$", RegexOptions.IgnoreCase)]
    private static partial Regex IsoDuration();

    [GeneratedRegex(@"<[^>]+>")]
    private static partial Regex Tags();

    [GeneratedRegex(@"\s{2,}")]
    private static partial Regex MultiSpace();
}
