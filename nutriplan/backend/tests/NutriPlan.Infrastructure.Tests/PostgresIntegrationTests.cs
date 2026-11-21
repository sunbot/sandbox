using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;
using NutriPlan.Application.Diary;
using NutriPlan.Application.Foods;
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

    private NutriPlanDbContext NewContext() =>
        new(new DbContextOptionsBuilder<NutriPlanDbContext>().UseNpgsql(_connectionString).UseSnakeCaseNamingConvention().Options);

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

    [PostgresFact]
    public async Task Barcode_lookup_prefers_local_foods()
    {
        await using var db = NewContext();
        db.Foods.Add(new Food("My granola", FoodSource.User, new(new Dictionary<int, double> { [1008] = 450, [1003] = 10, [1005] = 60, [1004] = 18 }), barcode: "012345678905"));
        await db.SaveChangesAsync();

        var found = await new FoodService(new FoodRepository(db), [], db).LookupBarcodeAsync("0012345678905"); // scanner reports EAN-13 for a UPC-A label
        Assert.Equal("My granola", found!.Name);
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

    private sealed class FixedClock(DateOnly today) : Application.Abstractions.IClock
    {
        public DateOnly Today => today;
        public DateTimeOffset Now => new(today.ToDateTime(new TimeOnly(12, 0)), TimeSpan.Zero);
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
