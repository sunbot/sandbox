using System.IO.Compression;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace NutriPlan.Application.Recipes.Import;

/// <summary>
/// Reads Paprika Recipe Manager exports.
///
/// Format (Paprika 3, "Export → Paprika Recipe Format"):
///   *.paprikarecipes  = a ZIP archive containing one entry per recipe
///   *.paprikarecipe   = each entry is a GZIP-compressed UTF-8 JSON object
/// A single *.paprikarecipe file (one recipe, gzip JSON) is also accepted.
/// </summary>
public static class PaprikaImporter
{
    private static readonly JsonSerializerOptions Json = new()
    {
        PropertyNameCaseInsensitive = true,
        NumberHandling = JsonNumberHandling.AllowReadingFromString,
    };

    public static IReadOnlyList<ImportedRecipe> Read(Stream stream) => ReadAll(stream).Recipes;

    /// <summary>
    /// Reads every recipe it can. An unreadable entry is reported in <c>Errors</c> instead of failing the whole file,
    /// so one corrupt recipe in a 300-recipe export doesn't block the rest.
    /// </summary>
    public static (IReadOnlyList<ImportedRecipe> Recipes, IReadOnlyList<string> Errors) ReadAll(Stream stream)
    {
        using var buffer = new MemoryStream();
        stream.CopyTo(buffer);
        var bytes = buffer.ToArray();
        var recipes = new List<ImportedRecipe>();
        var errors = new List<string>();

        if (IsZip(bytes))
        {
            using var zip = new ZipArchive(new MemoryStream(bytes), ZipArchiveMode.Read);
            foreach (var entry in zip.Entries.Where(e => e.Length > 0 && !e.FullName.StartsWith("__MACOSX/", StringComparison.Ordinal)
                                                          && !Path.GetFileName(e.FullName).StartsWith('.')))
            {
                try
                {
                    using var entryStream = entry.Open();
                    using var entryBuffer = new MemoryStream();
                    entryStream.CopyTo(entryBuffer);
                    var recipe = ReadSingle(entryBuffer.ToArray());
                    if (recipe is not null) recipes.Add(recipe);
                }
                catch (Exception ex) when (ex is InvalidDataException or JsonException)
                {
                    errors.Add($"{Path.GetFileNameWithoutExtension(entry.FullName)}: skipped, the file is damaged or isn't a Paprika recipe");
                }
            }
            return (recipes, errors);
        }

        var single = ReadSingle(bytes);
        if (single is not null) recipes.Add(single);
        return (recipes, errors);
    }

    /// <summary>One recipe: gzip JSON (normal) or plain JSON (tolerated).</summary>
    public static ImportedRecipe? ReadSingle(byte[] bytes)
    {
        var json = IsGzip(bytes) ? Gunzip(bytes) : bytes;
        if (json.Length >= 3 && json[0] == 0xEF && json[1] == 0xBB && json[2] == 0xBF) json = json[3..];
        var dto = JsonSerializer.Deserialize<PaprikaRecipeDto>(json, Json);
        return dto is null || string.IsNullOrWhiteSpace(dto.Name) ? null : Map(dto);
    }

    public static ImportedRecipe Map(PaprikaRecipeDto r)
    {
        byte[]? photo = null;
        if (!string.IsNullOrWhiteSpace(r.PhotoData))
        {
            try { photo = Convert.FromBase64String(r.PhotoData); }
            catch (FormatException) { /* corrupt photo shouldn't block the import */ }
        }

        return new ImportedRecipe
        {
            Name = r.Name!.Trim(),
            IngredientLines = SplitLines(r.Ingredients),
            Directions = Clean(r.Directions),
            Description = Clean(r.Description),
            Notes = Clean(r.Notes),
            ServingsText = Clean(r.Servings),
            Servings = ServingsParser.Parse(r.Servings) ?? ServingsParser.FindIn(r.NutritionalInfo, r.Notes, r.Description, r.Directions),
            PrepTime = Clean(r.PrepTime),
            CookTime = Clean(r.CookTime),
            TotalTime = Clean(r.TotalTime),
            SourceName = Clean(r.Source),
            SourceUrl = Clean(r.SourceUrl),
            ImageUrl = Clean(r.ImageUrl),
            Photo = photo,
            Categories = r.Categories ?? [],
            Rating = r.Rating is > 0 ? r.Rating : null,
            ExternalId = Clean(r.Uid),
            SourceNutritionText = Clean(r.NutritionalInfo),
        };
    }

    private static IReadOnlyList<string> SplitLines(string? text) =>
        string.IsNullOrWhiteSpace(text)
            ? []
            : text.Replace("\r\n", "\n").Split('\n').Select(l => l.Trim()).Where(l => l.Length > 0).ToList();

    private static string? Clean(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();

    private static bool IsZip(byte[] b) => b.Length > 4 && b[0] == 0x50 && b[1] == 0x4B;

    private static bool IsGzip(byte[] b) => b.Length > 2 && b[0] == 0x1F && b[1] == 0x8B;

    private static byte[] Gunzip(byte[] bytes)
    {
        using var input = new GZipStream(new MemoryStream(bytes), CompressionMode.Decompress);
        using var output = new MemoryStream();
        input.CopyTo(output);
        return output.ToArray();
    }

    /// <summary>The JSON shape Paprika writes. Unknown fields are ignored.</summary>
    public sealed class PaprikaRecipeDto
    {
        [JsonPropertyName("uid")] public string? Uid { get; set; }
        [JsonPropertyName("name")] public string? Name { get; set; }
        [JsonPropertyName("ingredients")] public string? Ingredients { get; set; }
        [JsonPropertyName("directions")] public string? Directions { get; set; }
        [JsonPropertyName("description")] public string? Description { get; set; }
        [JsonPropertyName("notes")] public string? Notes { get; set; }
        [JsonPropertyName("nutritional_info")] public string? NutritionalInfo { get; set; }
        [JsonPropertyName("servings")] public string? Servings { get; set; }
        [JsonPropertyName("prep_time")] public string? PrepTime { get; set; }
        [JsonPropertyName("cook_time")] public string? CookTime { get; set; }
        [JsonPropertyName("total_time")] public string? TotalTime { get; set; }
        [JsonPropertyName("difficulty")] public string? Difficulty { get; set; }
        [JsonPropertyName("rating")] public int? Rating { get; set; }
        [JsonPropertyName("source")] public string? Source { get; set; }
        [JsonPropertyName("source_url")] public string? SourceUrl { get; set; }
        [JsonPropertyName("image_url")] public string? ImageUrl { get; set; }
        [JsonPropertyName("photo_data")] public string? PhotoData { get; set; }
        [JsonPropertyName("categories")] public List<string>? Categories { get; set; }
    }
}
