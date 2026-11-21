using System.IO.Compression;
using System.Text;
using System.Text.Json;
using NutriPlan.Application.Recipes;
using NutriPlan.Application.Recipes.Import;

namespace NutriPlan.Application.Tests;

public class ImportTests
{
    private static byte[] Gzip(string text)
    {
        using var ms = new MemoryStream();
        using (var gz = new GZipStream(ms, CompressionLevel.Optimal, leaveOpen: true))
            gz.Write(Encoding.UTF8.GetBytes(text));
        return ms.ToArray();
    }

    private static string PaprikaJson(string uid, string name) => JsonSerializer.Serialize(new Dictionary<string, object?>
    {
        ["uid"] = uid,
        ["name"] = name,
        ["ingredients"] = "2 cups flour\r\n1 tsp salt\r\n\r\nFOR THE GLAZE:\r\n1 cup powdered sugar",
        ["directions"] = "Mix.\nBake.",
        ["servings"] = "Makes 12 muffins",
        ["categories"] = new[] { "Baking", "Christmas" },
        ["source_url"] = "https://example.com/muffins",
        ["nutritional_info"] = "Calories: 210",
        ["rating"] = 4,
        ["photo_data"] = Convert.ToBase64String([0xFF, 0xD8, 0xFF]),
        ["some_future_field"] = "ignored",
    });

    [Theory]
    [InlineData("80/20 ground beef", "beef ground 80 lean meat 20 fat raw")]
    [InlineData("ground beef (85/15)", "beef ground 85 lean meat 15 fat raw")]
    [InlineData("93% lean ground beef", "beef ground 93 lean meat 7 fat raw")]
    [InlineData("ground beef", "beef ground 80 lean meat 20 fat raw")]
    [InlineData("Italian bread crumbs", "bread crumbs dry grated seasoned")]
    [InlineData("panko", "bread crumbs dry grated plain")]
    [InlineData("Rao's Homemade marinara sauce", "spaghetti sauce")]
    [InlineData("bone-in pork shoulder", "pork fresh shoulder whole separable lean and fat raw")]
    [InlineData("ground cumin", "spices cumin seed")]
    [InlineData("kosher salt", "salt table")]
    [InlineData("extra-virgin olive oil", "oil olive salad or cooking")]
    [InlineData("spaghetti", "pasta dry enriched")]
    [InlineData("cooked penne", "pasta cooked enriched without added salt")]
    public void Recipe_words_map_to_usda_names(string text, string expected) => Assert.Equal(expected, IngredientQuery.Clean(text));

    [Theory]
    [InlineData("spaghetti squash")]
    [InlineData("whole milk")]
    [InlineData("chicken breast")]
    public void Foods_without_an_alias_are_left_alone(string text) => Assert.Null(IngredientQuery.Alias(text));

    [Theory]
    [InlineData(6.0, null, "Nutrition Facts\nServings: 6 to 10\nCalories 1124")]
    [InlineData(4.0, "Serves 4 as a main.", null)]
    [InlineData(8.0, null, "Yield: 8")]
    [InlineData(null, "Serving size: 1 cup", null)]
    [InlineData(null, null, null)]
    public void Finds_servings_in_other_recipe_text(double? expected, string? notes, string? nutrition) =>
        Assert.Equal(expected, ServingsParser.FindIn(nutrition, notes));

    [Fact]
    public void One_corrupt_entry_does_not_block_the_rest_of_the_export()
    {
        using var zipStream = new MemoryStream();
        using (var zip = new ZipArchive(zipStream, ZipArchiveMode.Create, leaveOpen: true))
        {
            void Add(string name, byte[] data) { using var w = zip.CreateEntry(name).Open(); w.Write(data); }
            Add("Muffins.paprikarecipe", Gzip(PaprikaJson("U1", "Muffins")));
            Add("Broken.paprikarecipe", Gzip("{ not json"));
            Add("__MACOSX/._Muffins.paprikarecipe", [1, 2, 3]);
            Add("Plain.paprikarecipe", [0xEF, 0xBB, 0xBF, .. Encoding.UTF8.GetBytes(PaprikaJson("U3", "Plain JSON"))]);
        }
        zipStream.Position = 0;

        var (recipes, errors) = PaprikaImporter.ReadAll(zipStream);

        Assert.Equal(["Muffins", "Plain JSON"], recipes.Select(r => r.Name).ToArray());
        Assert.Single(errors);
        Assert.StartsWith("Broken:", errors[0]);
    }

    [Fact]
    public void Tolerates_numbers_written_as_strings()
    {
        var json = """{"uid":"U4","name":"Soup","rating":"5","ingredients":"1 cup stock"}""";
        var recipe = PaprikaImporter.ReadSingle(Encoding.UTF8.GetBytes(json));
        Assert.Equal(5, recipe!.Rating);
    }

    [Fact]
    public void Reads_a_paprikarecipes_zip_of_gzipped_json()
    {
        using var zipStream = new MemoryStream();
        using (var zip = new ZipArchive(zipStream, ZipArchiveMode.Create, leaveOpen: true))
        {
            foreach (var (uid, name) in new[] { ("U1", "Muffins"), ("U2", "Scones") })
            {
                using var entry = zip.CreateEntry($"{name}.paprikarecipe").Open();
                entry.Write(Gzip(PaprikaJson(uid, name)));
            }
        }
        zipStream.Position = 0;

        var recipes = PaprikaImporter.Read(zipStream);

        Assert.Equal(2, recipes.Count);
        var muffins = recipes.Single(r => r.Name == "Muffins");
        Assert.Equal("U1", muffins.ExternalId);
        Assert.Equal(12, muffins.Servings);
        Assert.Equal(["2 cups flour", "1 tsp salt", "FOR THE GLAZE:", "1 cup powdered sugar"], muffins.IngredientLines);
        Assert.Equal(["Baking", "Christmas"], muffins.Categories);
        Assert.Equal(3, muffins.Photo!.Length);
        Assert.Equal("Calories: 210", muffins.SourceNutritionText);
    }

    [Fact]
    public void Reads_a_single_paprikarecipe_file()
    {
        var recipes = PaprikaImporter.Read(new MemoryStream(Gzip(PaprikaJson("U9", "Bread"))));
        Assert.Equal("Bread", Assert.Single(recipes).Name);
    }

    [Fact]
    public void Extracts_schema_org_recipe_from_graph_with_sections()
    {
        const string html = """
            <html><head>
            <script type="application/ld+json">{"@context":"https://schema.org","@type":"WebSite","name":"Blog"}</script>
            <script type="application/ld+json">
            {"@context":"https://schema.org","@graph":[
              {"@type":"Organization","name":"Blog"},
              {"@type":["Recipe","NewsArticle"],"name":"Gingerbread Cookies &amp; Icing",
               "recipeYield":["24","24 cookies"],"prepTime":"PT20M","cookTime":"PT1H10M",
               "recipeIngredient":["3 cups flour","1 &frac12; tsp ginger","<b>3/4 cup</b> molasses"],
               "recipeCategory":"Dessert","keywords":"christmas, holiday, cookies",
               "image":[{"@type":"ImageObject","url":"https://example.com/g.jpg"}],
               "nutrition":{"@type":"NutritionInformation","calories":"150 kcal"},
               "recipeInstructions":[
                 {"@type":"HowToSection","name":"Dough","itemListElement":[{"@type":"HowToStep","text":"Mix dry."},{"@type":"HowToStep","text":"Add molasses."}]},
                 {"@type":"HowToStep","text":"Bake 10 minutes."}]}
            ]}
            </script></head><body></body></html>
            """;

        var r = JsonLdRecipeExtractor.Extract(html, new Uri("https://www.example.com/gingerbread"))!;

        Assert.Equal("Gingerbread Cookies & Icing", r.Name);
        Assert.Equal(24, r.Servings);
        Assert.Equal(["3 cups flour", "1 ½ tsp ginger", "3/4 cup molasses"], r.IngredientLines);
        Assert.Equal("20 min", r.PrepTime);
        Assert.Equal("1 h 10 min", r.CookTime);
        Assert.Equal("https://example.com/g.jpg", r.ImageUrl);
        Assert.Equal("example.com", r.SourceName);
        Assert.Contains("christmas", r.Categories);
        Assert.Contains("# Dough", r.Directions);
        Assert.Contains("Bake 10 minutes.", r.Directions);
        Assert.Contains("calories: 150 kcal", r.SourceNutritionText);
    }

    [Fact]
    public void Returns_null_when_page_has_no_recipe() =>
        Assert.Null(JsonLdRecipeExtractor.Extract("<html><script type=\"application/ld+json\">{\"@type\":\"Article\"}</script></html>"));

    [Theory]
    [InlineData("4", 4.0)]
    [InlineData("Serves 6-8", 6.0)]
    [InlineData("Makes 24 cookies", 24.0)]
    [InlineData("2 loaves", 2.0)]
    [InlineData("", null)]
    public void Parses_servings(string text, double? expected) => Assert.Equal(expected, ServingsParser.Parse(text));
}
