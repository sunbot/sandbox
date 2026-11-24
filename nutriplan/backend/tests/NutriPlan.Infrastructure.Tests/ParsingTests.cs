using System.Text.Json;
using NutriPlan.Application.Abstractions;
using NutriPlan.Domain.Foods;
using NutriPlan.Domain.Nutrients;
using NutriPlan.Infrastructure.Ai;
using NutriPlan.Infrastructure.Configuration;
using NutriPlan.Infrastructure.External;
using NutriPlan.Infrastructure.Usda;

namespace NutriPlan.Infrastructure.Tests;

public class ParsingTests
{
    [Fact]
    public void Open_food_facts_units_are_converted_to_ours()
    {
        // Trimmed real response shape (OFF stores minerals/vitamins in grams).
        const string json = """
            {"code":"0737628064502","status":1,"product":{
              "product_name":"Rice Noodles","brands":"Thai Kitchen, Simply Asia","serving_size":"2 oz (56 g)","serving_quantity":56,
              "categories_tags":["en:plant-based-foods","en:noodles"],
              "nutriments":{"energy-kcal_100g":385,"proteins_100g":7.69,"carbohydrates_100g":71.15,"fat_100g":7.69,
                "fiber_100g":1.9,"sugars_100g":12.37,"sodium_100g":0.788,"calcium_100g":0.038,"iron_100g":0.0014,
                "vitamin-d_100g":0.0000025,"cholesterol_100g":0}}}
            """;
        using var doc = JsonDocument.Parse(json);
        var food = OpenFoodFactsProvider.Parse(doc.RootElement, "0737628064502")!;

        Assert.Equal("Rice Noodles", food.Name);
        Assert.Equal("Thai Kitchen", food.Brand);
        Assert.Equal(FoodSource.OpenFoodFacts, food.Source);
        Assert.Equal(385, food.NutrientsPer100g.Calories);
        Assert.Equal(788, food.NutrientsPer100g[NutrientIds.Sodium]);
        Assert.Equal(38, food.NutrientsPer100g[NutrientIds.Calcium]);
        Assert.Equal(1.4, food.NutrientsPer100g[NutrientIds.Iron]!.Value, 6);
        Assert.Equal(2.5, food.NutrientsPer100g[NutrientIds.VitaminD]!.Value, 6);
        Assert.Equal(56, food.Portions.Single().GramWeight);
        Assert.Equal("Noodles", food.Category);
    }

    [Fact]
    public void Open_food_facts_falls_back_to_kj_and_salt()
    {
        const string json = """{"product":{"product_name":"X","nutriments":{"energy_100g":418.4,"salt_100g":1.0,"proteins_100g":0,"carbohydrates_100g":25,"fat_100g":0}}}""";
        using var doc = JsonDocument.Parse(json);
        var food = OpenFoodFactsProvider.Parse(doc.RootElement, "123")!;
        Assert.Equal(100, food.NutrientsPer100g.Calories, 1);
        Assert.Equal(400, food.NutrientsPer100g[NutrientIds.Sodium]);
    }

    [Fact]
    public void Open_food_facts_without_energy_is_rejected()
    {
        using var doc = JsonDocument.Parse("""{"product":{"product_name":"X","nutriments":{"fat_100g":3}}}""");
        Assert.Null(OpenFoodFactsProvider.Parse(doc.RootElement, "123"));
    }

    [Fact]
    public void Usda_energy_falls_back_to_atwater_and_drops_helpers()
    {
        var map = new Dictionary<int, double> { [NutrientIds.EnergyAtwaterGeneral] = 106, [NutrientIds.EnergyAtwaterSpecific] = 112.2, [NutrientIds.SugarsTotalNlea] = 3 };
        Assert.True(UsdaImporter.Normalize(map));
        Assert.Equal(112.2, map[NutrientIds.Energy]);
        Assert.Equal(3, map[NutrientIds.SugarsTotal]);
        Assert.False(map.ContainsKey(NutrientIds.EnergyAtwaterGeneral));
        Assert.False(UsdaImporter.Normalize(new Dictionary<int, double> { [NutrientIds.Protein] = 3 }));

        var chicken = new Dictionary<int, double> { [NutrientIds.Energy] = 132, [NutrientIds.Carbohydrate] = -0.44 };
        UsdaImporter.Normalize(chicken);
        Assert.Equal(0, chicken[NutrientIds.Carbohydrate]);
    }

    [Fact]
    public void Foundation_total_folate_becomes_DFE_only_when_no_folic_acid_can_be_present()
    {
        // Foundation foods publish total folate (1177), never DFE (1190).
        var spinach = new Dictionary<int, double> { [NutrientIds.Energy] = 23, [NutrientIds.FolateTotal] = 194 };
        UsdaImporter.Normalize(spinach, "Spinach, mature, raw");
        Assert.Equal(194, spinach[NutrientIds.Folate]);
        Assert.False(spinach.ContainsKey(NutrientIds.FolateTotal));

        // Enriched or fortified: part of the total is folic acid (1.7× in DFE) in an unknown share, so it stays unknown.
        var flour = new Dictionary<int, double> { [NutrientIds.Energy] = 364, [NutrientIds.FolateTotal] = 291 };
        UsdaImporter.Normalize(flour, "Flour, wheat, all-purpose, enriched, bleached");
        Assert.False(flour.ContainsKey(NutrientIds.Folate));
        Assert.False(flour.ContainsKey(NutrientIds.FolateTotal));

        // With the split published, DFE is calculated: food folate + 1.7 × folic acid.
        var cereal = new Dictionary<int, double> { [NutrientIds.Energy] = 380, [NutrientIds.FolateFood] = 20, [NutrientIds.FolicAcid] = 100, [NutrientIds.FolateTotal] = 120 };
        UsdaImporter.Normalize(cereal, "Cereal, fortified");
        Assert.Equal(190, cereal[NutrientIds.Folate]);

        // A reported DFE is never overwritten.
        var sr = new Dictionary<int, double> { [NutrientIds.Energy] = 23, [NutrientIds.Folate] = 194, [NutrientIds.FolateTotal] = 194 };
        UsdaImporter.Normalize(sr, "Spinach, raw");
        Assert.Equal(194, sr[NutrientIds.Folate]);
    }

    [Theory]
    [InlineData("1 cup", null, "cup", 1)]
    [InlineData("1/2 cup, chopped", null, "cup, chopped", 0.5)]
    [InlineData("medium or regular slice", null, "medium or regular slice", 1)]
    [InlineData("tablespoon", 2.0, "tablespoon", 2)]
    public void Usda_portions_are_normalized(string description, double? amount, string expected, double expectedAmount)
    {
        var result = UsdaImporter.NormalizePortion(description, amount)!.Value;
        Assert.Equal(expected, result.Description);
        Assert.Equal(expectedAmount, result.Amount);
    }

    [Theory]
    [InlineData("Guideline amount per fl oz of beverage")]
    [InlineData("1 cup, dry, yields")]
    [InlineData("")]
    public void Misleading_usda_portions_are_dropped(string description) =>
        Assert.Null(UsdaImporter.NormalizePortion(description, 1));

    [Fact]
    public void Usda_portion_description_combines_unit_and_modifier()
    {
        var units = new Dictionary<int, string> { [1000] = "cup", [9999] = "undetermined" };
        Assert.Equal("cup, chopped", UsdaImporter.PortionDescription(new() { measure_unit_id = 1000, modifier = "chopped" }, units));
        Assert.Equal("large", UsdaImporter.PortionDescription(new() { measure_unit_id = 9999, modifier = "large" }, units));
        Assert.Equal("slice", UsdaImporter.PortionDescription(new() { measure_unit_id = 9999, portion_description = "slice", modifier = "10205" }, units));
    }

    [Fact]
    public void Claude_structured_output_maps_to_request()
    {
        using var doc = JsonDocument.Parse("""
            {"intent":"log_food","items":[
               {"food_query":"chicken breast","amount":0.5,"unit":"lb","preparation":"grilled","brand":null,"cooked_state":"cooked"},
               {"food_query":"rice white","amount":1,"unit":"cup","preparation":null,"brand":null,"cooked_state":null}],
             "meal":"dinner","date":"2026-11-17","recipe_query":null,"recipe_count":null,"reply":null}
            """);
        var r = ClaudeInterpreter.Map(doc.RootElement);
        Assert.Equal(AssistantIntent.LogFood, r.Intent);
        Assert.Equal(2, r.Items.Count);
        Assert.Equal(0.5, r.Items[0].Amount);
        Assert.Equal("cooked", r.Items[0].CookedState);
        Assert.Equal(Domain.Diary.MealSlot.Dinner, r.Meal);
        Assert.Equal(new DateOnly(2026, 11, 17), r.Date);
    }

    [Theory]
    [InlineData("127.0.0.1", true)]
    [InlineData("10.1.2.3", true)]
    [InlineData("192.168.1.10", true)]
    [InlineData("172.20.0.1", true)]
    [InlineData("169.254.169.254", true)]
    [InlineData("::1", true)]
    [InlineData("8.8.8.8", false)]
    [InlineData("151.101.1.140", false)]
    public void Recipe_fetcher_blocks_private_addresses(string ip, bool isPrivate) =>
        Assert.Equal(isPrivate, HttpWebPageFetcher.IsPrivate(System.Net.IPAddress.Parse(ip)));

    [Fact]
    public void Hosted_database_urls_become_npgsql_connection_strings()
    {
        var cs = new Npgsql.NpgsqlConnectionStringBuilder(Persistence.ConnectionStrings.FromUrlOrRaw(
            "postgresql://alex:p%40ss@ep-cool-1.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require"));
        Assert.Equal("ep-cool-1.us-east-2.aws.neon.tech", cs.Host);
        Assert.Equal(5432, cs.Port);
        Assert.Equal("neondb", cs.Database);
        Assert.Equal("alex", cs.Username);
        Assert.Equal("p@ss", cs.Password);
        Assert.Equal(Npgsql.SslMode.Require, cs.SslMode);
        Assert.Equal(Npgsql.ChannelBinding.Require, cs.ChannelBinding);

        const string raw = "Host=localhost;Database=nutriplan;Username=u;Password=p";
        Assert.Equal(raw, Persistence.ConnectionStrings.FromUrlOrRaw(raw));
    }

    [Fact]
    public void Dotenv_files_parse_and_prefer_env_local()
    {
        var parsed = DotEnv.Parse("""
            # Neon
            DATABASE_URL="postgresql://u:p@ep-x.neon.tech/db?sslmode=require"
            export Claude__ApiKey='sk-test'
            App__TimeZone=America/Chicago # my zone
            EMPTY=
            not a pair
            """);
        Assert.Equal("postgresql://u:p@ep-x.neon.tech/db?sslmode=require", parsed["DATABASE_URL"]);
        Assert.Equal("sk-test", parsed["Claude:ApiKey"]);
        Assert.Equal("America/Chicago", parsed["App:TimeZone"]);
        Assert.Equal("", parsed["EMPTY"]);
        Assert.False(parsed.ContainsKey("not a pair"));

        var root = Directory.CreateTempSubdirectory("dotenv").FullName;
        var deep = Directory.CreateDirectory(Path.Combine(root, "a", "b")).FullName;
        File.WriteAllText(Path.Combine(root, ".env"), "DATABASE_URL=from-env\nONLY_IN_ENV=1");
        File.WriteAllText(Path.Combine(root, ".env.local"), "DATABASE_URL=from-local");
        var config = new Microsoft.Extensions.Configuration.ConfigurationBuilder().AddDotEnvFiles(deep).Build();
        Assert.Equal("from-local", config["DATABASE_URL"]);
        Assert.Equal("1", config["ONLY_IN_ENV"]);
    }
}
