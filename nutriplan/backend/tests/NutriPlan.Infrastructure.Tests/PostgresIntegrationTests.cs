using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;
using NutriPlan.Application.Diary;
using NutriPlan.Application.Foods;
using NutriPlan.Application.Recipes;
using NutriPlan.Domain.Recipes;
using NutriPlan.Domain.Diary;
using NutriPlan.Domain.Foods;
using NutriPlan.Infrastructure.Persistence;
using NutriPlan.Infrastructure.Usda;

namespace NutriPlan.Infrastructure.Tests;

/// <summary>Runs only when NUTRIPLAN_TEST_DB is set to a Postgres connection string with CREATEDB rights.</summary>
public sealed class PostgresFactAttribute : FactAttribute
{
    public const string Variable = "NUTRIPLAN_TEST_DB";

    public PostgresFactAttribute()
    {
        if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable(Variable)))
            Skip = $"Set {Variable} (e.g. Host=localhost;Username=nutriplan;Password=nutriplan) to run database tests.";
    }
}

public sealed class PostgresIntegrationTests : IAsyncLifetime
{
    private string _connectionString = "";
    private string _database = "";

    public async Task InitializeAsync()
    {
        var baseCs = Environment.GetEnvironmentVariable(PostgresFactAttribute.Variable);
        if (string.IsNullOrWhiteSpace(baseCs)) return;
        _database = $"nutriplan_test_{Guid.NewGuid():N}";
        await using (var conn = new NpgsqlConnection(baseCs))
        {
            await conn.OpenAsync();
            await new NpgsqlCommand($"CREATE DATABASE {_database}", conn).ExecuteNonQueryAsync();
        }
        _connectionString = new NpgsqlConnectionStringBuilder(baseCs) { Database = _database }.ConnectionString;
        await using var db = NewContext();
        await db.Database.MigrateAsync();
    }

    public async Task DisposeAsync()
    {
        var baseCs = Environment.GetEnvironmentVariable(PostgresFactAttribute.Variable);
        if (string.IsNullOrWhiteSpace(baseCs) || _database.Length == 0) return;
        NpgsqlConnection.ClearAllPools();
        await using var conn = new NpgsqlConnection(baseCs);
        await conn.OpenAsync();
        await new NpgsqlCommand($"DROP DATABASE IF EXISTS {_database} WITH (FORCE)", conn).ExecuteNonQueryAsync();
    }

    /// <summary>A context acting as one signed-in user (the migrated legacy owner unless another user is named).</summary>
    private NutriPlanDbContext NewContext(Guid? user = null) =>
        new(new DbContextOptionsBuilder<NutriPlanDbContext>().UseNpgsql(_connectionString).UseSnakeCaseNamingConvention().Options,
            new TestUser(user ?? Domain.Users.AppUser.LegacyOwnerId));

    [PostgresFact]
    public async Task Usda_import_search_and_logging_work_end_to_end()
    {
        var folder = WriteUsdaFixture();

        await using (var db = NewContext())
        {
            var result = await new UsdaImporter(db, NullLogger<UsdaImporter>.Instance).ImportAsync(folder);
            Assert.Equal(3, result.Imported);
            var again = await new UsdaImporter(db, NullLogger<UsdaImporter>.Instance).ImportAsync(folder);
            Assert.Equal(0, again.Imported); // idempotent
        }

        await using (var db = NewContext())
        {
            var foods = new FoodRepository(db);
            var service = new FoodService(foods, [], db);
            var results = await service.SearchAsync("eggs");
            Assert.Equal("Egg, whole, raw, fresh", results[0].Name);
            Assert.Equal(50, results[0].Portions.Single(p => p.Description == "large").Grams);

            var diary = new DiaryService(new DiaryRepository(db), foods, new RecipeRepository(db), new TargetsRepository(db), db, new PlanRepository(db));
            var egg = results[0];
            await diary.LogFoodAsync(new LogFoodRequest(new DateOnly(2026, 11, 18), MealSlot.Breakfast, egg.Id, null, 2, "large"));
            await diary.LogFoodAsync(new LogFoodRequest(new DateOnly(2026, 11, 19), MealSlot.Breakfast, egg.Id, null, 3, null));
        }

        await using (var db = NewContext())
        {
            var day = await new DiaryService(new DiaryRepository(db), new FoodRepository(db), new RecipeRepository(db), new TargetsRepository(db), db, new PlanRepository(db))
                .GetDayAsync(new DateOnly(2026, 11, 18));
            Assert.Equal(143, day.Totals.Calories, 1); // 100 g of egg

            // Usage counts (jsonb query) feed the ranker.
            var rows = await new FoodRepository(db).SearchAsync("egg", 10);
            Assert.Equal(2, rows.Single(r => r.Food.Name == "Egg, whole, raw, fresh").TimesLogged);

            var frequent = await new DiaryRepository(db).GetFrequentItemsAsync(36500, 10);
            Assert.Equal(2, frequent.Single().Count);
        }
    }

    private sealed class NoWeb : NutriPlan.Application.Abstractions.IWebPageFetcher
    {
        public Task<string> GetHtmlAsync(Uri url, CancellationToken ct = default) => throw new NotSupportedException();
    }

    [PostgresFact]
    public async Task A_recipe_used_inside_another_is_saved_reloaded_and_updates_its_parent()
    {
        Guid sauceId, pastaId;
        await using (var db = NewContext())
        {
            var food = new Food("Tomato base", FoodSource.User, new Domain.Nutrients.NutrientProfile(new Dictionary<int, double> { [Domain.Nutrients.NutrientIds.Energy] = 100 }));
            db.Foods.Add(food);
            await db.SaveChangesAsync();
            var svc = new RecipeService(new RecipeRepository(db), new FoodRepository(db), new FoodService(new FoodRepository(db), [], db), new NoWeb(), db);
            sauceId = (await svc.CreateAsync(new SaveRecipeRequest("Sauce", 4, ["400 g tomato base"], null, null, null, null, 800, 950))).Summary.Id;
            await svc.UpdateIngredientAsync(sauceId, 0, new UpdateIngredientRequest(food.Id, 400, null, null, null));
            pastaId = (await svc.CreateAsync(new SaveRecipeRequest("Pasta bake", 2, ["200 g sauce"], null, null, null, null, null))).Summary.Id;
            await svc.UpdateIngredientAsync(pastaId, 0, new UpdateIngredientRequest(null, null, 200, "g", null, sauceId));
        }
        await using (var db = NewContext())
        {
            var pasta = await db.Recipes.SingleAsync(r => r.Id == pastaId);
            var line = pasta.Ingredients.Single();
            Assert.Equal(sauceId, line.RecipeId);
            Assert.Equal(1, line.Servings!.Value, 3);
            Assert.Equal(50, pasta.NutritionPerServing.Calories, 1);   // a quarter of 400 kcal over 2 servings
            Assert.Equal(950, (await db.Recipes.SingleAsync(r => r.Id == sauceId)).FinishedVolumeMl);

            var svc = new RecipeService(new RecipeRepository(db), new FoodRepository(db), new FoodService(new FoodRepository(db), [], db), new NoWeb(), db);
            await svc.SetServingsAsync(sauceId, 2);                          // the 200 g is now 0.5 of 2 servings: same food, same calories
            await svc.UpdateAsync(sauceId, new SaveRecipeRequest("Sauce", 2, ["400 g tomato base"], null, null, null, null, 400));
        }
        await using (var db = NewContext())
        {
            var pasta = await db.Recipes.SingleAsync(r => r.Id == pastaId);
            Assert.Equal(100, pasta.NutritionPerServing.Calories, 1);  // 200 of 400 g now: half of 400 kcal over 2 servings
            Assert.Equal(1, pasta.Ingredients.Single().Servings!.Value, 3);
        }
    }

    [PostgresFact]
    public async Task Barcode_lookup_prefers_local_foods()
    {
        await using var db = NewContext();
        db.Foods.Add(new Food("My granola", FoodSource.User, new(new Dictionary<int, double> { [1008] = 450, [1003] = 10, [1005] = 60, [1004] = 18 }), barcode: "012345678905"));
        await db.SaveChangesAsync();

        var found = await new FoodService(new FoodRepository(db), [], db).LookupBarcodeAsync("0012345678905"); // scanner reports EAN-13 for a UPC-A label
        Assert.Equal("My granola", found.Food!.Name);
    }

    [PostgresFact]
    public async Task A_planned_meal_can_be_logged_only_once_and_deleting_the_log_restores_the_plan()
    {
        await using (var db = NewContext())
        {
            db.Foods.Add(new Food("Oats", FoodSource.User, new(new Dictionary<int, double> { [1008] = 379, [1003] = 13, [1005] = 68, [1004] = 6.5 })));
            await db.SaveChangesAsync();
        }

        var date = new DateOnly(2026, 11, 21);
        Guid planId, foodId;
        await using (var db = NewContext())
        {
            foodId = db.Foods.Single().Id;
            var plans = new Application.Planning.PlanService(new PlanRepository(db), new DiaryRepository(db), new TargetsRepository(db),
                new DiaryService(new DiaryRepository(db), new FoodRepository(db), new RecipeRepository(db), new TargetsRepository(db), db, new PlanRepository(db)),
                new FixedClock(date), db);
            var planned = await plans.AddFoodAsync(new Application.Planning.AddPlanFoodRequest(date, MealSlot.Dinner, foodId, 100, null, null));
            planId = planned.Id;
            await plans.MarkEatenAsync(planId);
        }

        // The database itself refuses a second diary entry for the same plan entry (a double tap or racing retry).
        await using (var db = NewContext())
        {
            var plan = await new PlanRepository(db).GetAsync(planId);
            db.DiaryEntries.Add(plan!.ToDiaryEntry(1));
            var ex = await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
            Assert.Equal("23505", (ex.InnerException as PostgresException)?.SqlState);
        }

        await using (var db = NewContext())
        {
            Assert.Single(db.DiaryEntries);
            var entry = db.DiaryEntries.Single();
            var diary = new DiaryService(new DiaryRepository(db), new FoodRepository(db), new RecipeRepository(db), new TargetsRepository(db), db, new PlanRepository(db));
            await diary.DeleteAsync(entry.Id);
        }

        await using (var db = NewContext())
        {
            Assert.Empty(db.DiaryEntries);
            Assert.Equal(Domain.Planning.PlanStatus.Planned, (await new PlanRepository(db).GetAsync(planId))!.Status);
        }
    }

    [PostgresFact]
    public async Task A_branded_product_is_stored_once_and_a_drink_keeps_its_volume_basis()
    {
        var per100 = new Domain.Nutrients.NutrientProfile(new Dictionary<int, double> { [1008] = 48, [1003] = 9.1 });
        await using (var db = NewContext())
        {
            db.Foods.Add(new Food("High Protein Shake", FoodSource.UsdaBranded, per100, sourceId: "111", brand: "Premier Protein",
                portions: [new FoodPortion("shake", 330)], basis: NutrientBasis.Volume));
            await db.SaveChangesAsync();
        }
        await using (var db = NewContext())
        {
            var shake = await new FoodRepository(db).FindBySourceAsync(FoodSource.UsdaBranded, "111");
            Assert.Equal(NutrientBasis.Volume, shake!.Basis);
            Assert.Equal("ml", Application.Common.FoodSummaryDto.From(shake).BaseUnit);

            db.Foods.Add(new Food("High Protein Shake (again)", FoodSource.UsdaBranded, per100, sourceId: "111"));
            var ex = await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
            Assert.Equal("23505", (ex.InnerException as PostgresException)?.SqlState);
        }
        await using (var db = NewContext())
        {
            // Other sources may share ids (e.g. a USDA generic and a user food): the rule is only for cached branded products.
            db.Foods.Add(new Food("Shake I made", FoodSource.User, per100, sourceId: "111"));
            await db.SaveChangesAsync();
            Assert.Equal(NutrientBasis.Mass, (await new FoodRepository(db).FindBySourceAsync(FoodSource.User, "111"))!.Basis);
        }
    }

    private sealed class FixedClock(DateOnly today) : Application.Abstractions.IClock
    {
        public DateOnly Today => today;
        public DateTimeOffset Now => new(today.ToDateTime(new TimeOnly(12, 0)), TimeSpan.Zero);
    }

    [PostgresFact]
    public async Task Foundation_foods_without_portions_borrow_their_linked_SR_portions_once_and_only_when_safe()
    {
        var (foundation, sr) = WriteLinkedUsdaFixture();
        await using (var db = NewContext())
        {
            await new UsdaImporter(db, NullLogger<UsdaImporter>.Instance).ImportAsync(foundation);
            await new UsdaImporter(db, NullLogger<UsdaImporter>.Instance).ImportAsync(sr);
        }
        Guid almondsId;
        double kcalBefore;
        await using (var db = NewContext())
        {
            var almonds = await db.Foods.SingleAsync(f => f.SourceId == "2346393");
            Assert.Empty(almonds.Portions); // USDA lists no portions for it, and re-importing won't add any
            (almondsId, kcalBefore) = (almonds.Id, almonds.NutrientsPer100g.Calories);

            var dry = await new UsdaPortionEnricher(db, NullLogger<UsdaPortionEnricher>.Instance).RunAsync([foundation, sr], apply: false);
            Assert.Equal(["Nuts, almonds, whole, raw"], dry.Changes.Select(c => c.FoodName));
            Assert.Contains(dry.Rejected, r => r.Contains("Apples, honeycrisp"));
        }
        await using (var db = NewContext())
            Assert.Empty((await db.Foods.SingleAsync(f => f.Id == almondsId)).Portions); // a dry run saves nothing

        await using (var db = NewContext())
        {
            var applied = await new UsdaPortionEnricher(db, NullLogger<UsdaPortionEnricher>.Instance).RunAsync([foundation, sr], apply: true);
            Assert.Single(applied.Changes);
        }
        await using (var db = NewContext())
        {
            var almonds = await db.Foods.SingleAsync(f => f.Id == almondsId);
            Assert.Equal(["cup, whole", "almond"], almonds.Portions.Select(p => p.Description));
            Assert.All(almonds.Portions, p => Assert.Equal("USDA SR Legacy “Nuts, almonds” (FDC 170567, same NDB 12061)", p.Origin));
            Assert.Equal(kcalBefore, almonds.NutrientsPer100g.Calories);
            Assert.Equal("Nuts, almonds, whole, raw", almonds.Name);
            Assert.Empty((await db.Foods.SingleAsync(f => f.SourceId == "2344720")).Portions); // another variety: left without measures
            Assert.Equal(["large"], (await db.Foods.SingleAsync(f => f.SourceId == "2346400")).Portions.Select(p => p.Description)); // its own portion kept

            var again = await new UsdaPortionEnricher(db, NullLogger<UsdaPortionEnricher>.Instance).RunAsync([foundation, sr], apply: true);
            Assert.Empty(again.Changes); // idempotent
            var measures = Application.Common.FoodSummaryDto.From(almonds).Measures!;
            Assert.Equal(1.2, measures.Single(m => m.Unit == "almond").Base, 3);
            Assert.NotNull(measures.Single(m => m.Unit == "almond").Origin);
        }
    }

    /// <summary>A Foundation download and an SR Legacy download whose foods share USDA NDB numbers.</summary>
    private static (string Foundation, string Sr) WriteLinkedUsdaFixture()
    {
        string Dir(string name)
        {
            var d = Path.Combine(Path.GetTempPath(), $"usda_fixture_{name}_" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(d);
            File.WriteAllText(Path.Combine(d, "measure_unit.csv"), "\"id\",\"name\"\n\"1000\",\"cup\"\n\"9999\",\"undetermined\"\n");
            return d;
        }
        var f = Dir("fnd");
        File.WriteAllText(Path.Combine(f, "food.csv"), """
            "fdc_id","data_type","description","food_category_id","publication_date"
            "2346393","foundation_food","Nuts, almonds, whole, raw","12","2022-10-28"
            "2344720","foundation_food","Apples, honeycrisp, with skin, raw","9","2022-10-28"
            "2346400","foundation_food","Eggs, Grade A, Large, egg whole","1","2022-10-28"
            """);
        File.WriteAllText(Path.Combine(f, "foundation_food.csv"), """
            "fdc_id","NDB_number","footnote"
            "2346393","12061",""
            "2344720","9501",""
            "2346400","1123",""
            """);
        File.WriteAllText(Path.Combine(f, "food_nutrient.csv"), """
            "id","fdc_id","nutrient_id","amount"
            "1","2346393","1008","584"
            "2","2344720","1008","60"
            "3","2346400","1008","148"
            """);
        File.WriteAllText(Path.Combine(f, "food_portion.csv"), """
            "id","fdc_id","seq_num","amount","measure_unit_id","portion_description","modifier","gram_weight"
            "1","2346400","1","1","9999","","large","50"
            """);
        var s = Dir("sr");
        File.WriteAllText(Path.Combine(s, "food.csv"), """
            "fdc_id","data_type","description","food_category_id","publication_date"
            "170567","sr_legacy_food","Nuts, almonds","12","2019-04-01"
            "168203","sr_legacy_food","Apples, raw, golden delicious, with skin","9","2019-04-01"
            "171287","sr_legacy_food","Egg, whole, raw, fresh","1","2019-04-01"
            """);
        File.WriteAllText(Path.Combine(s, "sr_legacy_food.csv"), """
            "fdc_id","NDB_number"
            "170567","12061"
            "168203","9501"
            "171287","1123"
            """);
        File.WriteAllText(Path.Combine(s, "food_nutrient.csv"), """
            "id","fdc_id","nutrient_id","amount"
            "1","170567","1008","579"
            "2","168203","1008","57"
            "3","171287","1008","143"
            """);
        File.WriteAllText(Path.Combine(s, "food_portion.csv"), """
            "id","fdc_id","seq_num","amount","measure_unit_id","portion_description","modifier","gram_weight"
            "1","170567","1","1","1000","","whole","143"
            "2","170567","2","1","1000","","sliced","92"
            "3","170567","3","1","9999","","almond","1.2"
            "4","168203","1","1","9999","","medium","182"
            "5","171287","1","1","9999","","large","50"
            """);
        return (f, s);
    }

    /// <summary>A tiny SR-Legacy-shaped download: 3 foods, a few nutrients and portions.</summary>
    private static string WriteUsdaFixture()
    {
        var dir = Path.Combine(Path.GetTempPath(), "usda_fixture_" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        File.WriteAllText(Path.Combine(dir, "food.csv"), """
            "fdc_id","data_type","description","food_category_id","publication_date"
            "171287","sr_legacy_food","Egg, whole, raw, fresh","1","2019-04-01"
            "172183","sr_legacy_food","Egg, white, raw, fresh","1","2019-04-01"
            "999999","sr_legacy_food","Eggplant, raw","11","2019-04-01"
            "1","sample_food","Ignored sample","1","2019-04-01"
            """);
        File.WriteAllText(Path.Combine(dir, "food_nutrient.csv"), """
            "id","fdc_id","nutrient_id","amount","data_points","derivation_id","min","max","median","footnote","min_year_acquired"
            "1","171287","1008","143","","","","","","",""
            "2","171287","1003","12.56","","","","","","",""
            "3","171287","1004","9.51","","","","","","",""
            "4","171287","1005","0.72","","","","","","",""
            "5","172183","1008","52","","","","","","",""
            "6","172183","1003","10.9","","","","","","",""
            "7","999999","1008","25","","","","","","",""
            "8","999999","1005","5.88","","","","","","",""
            "9","999999","9999","1","","","","","","",""
            """);
        File.WriteAllText(Path.Combine(dir, "food_portion.csv"), """
            "id","fdc_id","seq_num","amount","measure_unit_id","portion_description","modifier","gram_weight","data_points","footnote","min_year_acquired"
            "1","171287","1","1","9999","","large","50","","",""
            "2","171287","2","1","9999","","medium","44","","",""
            "3","","1","1","9999","","bad row","10","","",""
            """);
        File.WriteAllText(Path.Combine(dir, "measure_unit.csv"), "\"id\",\"name\"\n\"1000\",\"cup\"\n\"9999\",\"undetermined\"\n");
        File.WriteAllText(Path.Combine(dir, "food_category.csv"), "\"id\",\"code\",\"description\"\n\"1\",\"0100\",\"Dairy and Egg Products\"\n\"11\",\"1100\",\"Vegetables and Vegetable Products\"\n");
        return dir;
    }
}

internal sealed class TestUser(Guid id) : Application.Abstractions.ICurrentUser
{
    public bool IsAuthenticated => true;
    public Guid Id => id;
}
