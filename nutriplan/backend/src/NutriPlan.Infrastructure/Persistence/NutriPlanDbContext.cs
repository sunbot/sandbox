using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;
using NutriPlan.Application.Abstractions;
using NutriPlan.Domain.Diary;
using NutriPlan.Domain.Foods;
using NutriPlan.Domain.Nutrients;
using NutriPlan.Domain.Pantry;
using NutriPlan.Domain.Planning;
using NutriPlan.Domain.Recipes;

namespace NutriPlan.Infrastructure.Persistence;

/// <summary>
/// One Postgres database. Nested value objects (nutrients, portions, ingredients, item snapshots) are stored
/// as jsonb: they're always read with their parent, which keeps the schema small and easy to change.
/// </summary>
public sealed class NutriPlanDbContext(DbContextOptions<NutriPlanDbContext> options) : DbContext(options), IUnitOfWork
{
    public DbSet<Food> Foods => Set<Food>();
    public DbSet<Recipe> Recipes => Set<Recipe>();
    public DbSet<DiaryEntry> DiaryEntries => Set<DiaryEntry>();
    public DbSet<PlanEntry> PlanEntries => Set<PlanEntry>();
    public DbSet<PantryItem> PantryItems => Set<PantryItem>();
    public DbSet<NutritionTargets> Targets => Set<NutritionTargets>();

    // Explicit, so it doesn't hide DbContext.SaveChangesAsync.
    async Task IUnitOfWork.SaveChangesAsync(CancellationToken ct) => await SaveChangesAsync(ct);

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.HasPostgresExtension("pg_trgm");

        b.Entity<Food>(e =>
        {
            e.ToTable("foods");
            e.HasKey(x => x.Id);
            e.Property(x => x.Name).HasMaxLength(400).IsRequired();
            e.Property(x => x.Brand).HasMaxLength(200);
            e.Property(x => x.SourceId).HasMaxLength(64);
            e.Property(x => x.Barcode).HasMaxLength(20);
            e.Property(x => x.Category).HasMaxLength(200);
            e.Property(x => x.QualityNote).HasMaxLength(400);
            e.Property(x => x.Source).HasConversion<string>().HasMaxLength(32);
            e.Property(x => x.Quality).HasConversion<string>().HasMaxLength(16);
            e.Property(x => x.NutrientsPer100g).HasColumnType("jsonb").HasConversion(Json.Profile, Json.ProfileComparer);
            e.Property<List<FoodPortion>>("_portions").HasColumnName("portions").HasColumnType("jsonb")
                .HasConversion(Json.Of<List<FoodPortion>>(), Json.ListComparer<FoodPortion>());
            e.Ignore(x => x.Portions);
            e.Ignore(x => x.DisplayName);
            e.Ignore(x => x.IsLabAnalyzed);
            e.Ignore(x => x.IsVolume);
            e.Ignore(x => x.BaseUnit);
            e.Property(x => x.Basis).HasConversion<string>().HasMaxLength(8).HasDefaultValue(NutrientBasis.Mass).HasSentinel((NutrientBasis)(-1));
            e.HasIndex(x => x.Barcode);
            // A cached USDA Branded product is stored once per FDC id, however many times it's searched or scanned.
            e.HasIndex(x => x.SourceId).IsUnique().HasFilter("source = 'UsdaBranded' AND source_id IS NOT NULL").HasDatabaseName("ux_foods_usda_branded_source_id");
            e.HasIndex(x => new { x.Source, x.SourceId });
            e.HasIndex(x => x.Name).HasMethod("gin").HasOperators("gin_trgm_ops").HasDatabaseName("ix_foods_name_trgm");
        });

        b.Entity<Recipe>(e =>
        {
            e.ToTable("recipes");
            e.HasKey(x => x.Id);
            e.Property(x => x.Name).HasMaxLength(300).IsRequired();
            e.Property(x => x.Origin).HasConversion<string>().HasMaxLength(16);
            e.Property(x => x.ExternalId).HasMaxLength(500);
            e.Property(x => x.NutritionPerServing).HasColumnType("jsonb").HasConversion(Json.Profile, Json.ProfileComparer);
            e.Property<List<RecipeIngredient>>("_ingredients").HasColumnName("ingredients").HasColumnType("jsonb")
                .HasConversion(Json.Of<List<RecipeIngredient>>(), Json.ListComparer<RecipeIngredient>());
            e.Property<List<string>>("_categories").HasColumnName("categories").HasColumnType("jsonb")
                .HasConversion(Json.Of<List<string>>(), Json.ListComparer<string>());
            e.Ignore(x => x.Ingredients);
            e.Ignore(x => x.Categories);
            e.Ignore(x => x.GramsPerServing);
            e.HasIndex(x => new { x.Origin, x.ExternalId });
            e.HasIndex(x => x.Name).HasMethod("gin").HasOperators("gin_trgm_ops").HasDatabaseName("ix_recipes_name_trgm");
        });

        b.Entity<DiaryEntry>(e =>
        {
            e.ToTable("diary_entries");
            e.HasKey(x => x.Id);
            e.Property(x => x.Meal).HasConversion<string>().HasMaxLength(16);
            e.Property(x => x.Item).HasColumnType("jsonb").HasConversion(Json.Of<ItemSnapshot>(), Json.Comparer<ItemSnapshot>());
            e.HasIndex(x => x.Date);
            // A planned meal is logged at most once, even if two requests race (double tap, retry).
            e.HasIndex(x => x.PlanEntryId).IsUnique().HasFilter("plan_entry_id IS NOT NULL").HasDatabaseName("ux_diary_entries_plan_entry_id");
        });

        b.Entity<PlanEntry>(e =>
        {
            e.ToTable("plan_entries");
            e.HasKey(x => x.Id);
            e.Property(x => x.Meal).HasConversion<string>().HasMaxLength(16);
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(16);
            e.Property(x => x.Item).HasColumnType("jsonb").HasConversion(Json.Of<ItemSnapshot>(), Json.Comparer<ItemSnapshot>());
            e.HasIndex(x => x.Date);
            e.HasIndex(x => x.BatchId);
        });

        b.Entity<PantryItem>(e =>
        {
            e.ToTable("pantry_items");
            e.HasKey(x => x.Id);
            e.Property(x => x.Name).HasMaxLength(200).IsRequired();
        });

        b.Entity<NutritionTargets>(e =>
        {
            e.ToTable("targets");
            e.HasKey(x => x.Id);
            e.Property(x => x.Id).ValueGeneratedNever();
            e.Property(x => x.BudgetMode).HasConversion<string>().HasMaxLength(16);
            e.Property(x => x.WeekStartsOn).HasConversion<string>().HasMaxLength(16);
            e.Property(x => x.NutrientOverrides).HasColumnType("jsonb")
                .HasConversion(Json.Of<Dictionary<int, double>>(), Json.Comparer<Dictionary<int, double>>());
            e.Property(x => x.FocusNutrients).HasColumnType("jsonb")
                .HasConversion(Json.Of<List<int>>(), Json.ListComparer<int>());
            e.Ignore(x => x.EffectiveFocusNutrients);
        });
    }

    /// <summary>JSON converters and comparers for jsonb columns.</summary>
    private static class Json
    {
        private static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
        {
            Converters = { new NutrientProfileJsonConverter(), new System.Text.Json.Serialization.JsonStringEnumConverter() },
        };

        public static readonly ValueConverter<NutrientProfile, string> Profile = new(
            p => JsonSerializer.Serialize(p.Amounts, Options),
            s => new NutrientProfile(JsonSerializer.Deserialize<Dictionary<int, double>>(s, Options) ?? new Dictionary<int, double>()));

        public static readonly ValueComparer<NutrientProfile> ProfileComparer = new(
            (a, c) => a!.Equals(c), p => p.GetHashCode(), p => p);

        public static ValueConverter<T, string> Of<T>() => new(
            v => JsonSerializer.Serialize(v, Options),
            s => JsonSerializer.Deserialize<T>(s, Options)!);

        /// <summary>Compares by serialized value so in-place edits (e.g. an ingredient's grams) are saved.</summary>
        public static ValueComparer<T> Comparer<T>() => new(
            (a, c) => JsonSerializer.Serialize(a, Options) == JsonSerializer.Serialize(c, Options),
            v => JsonSerializer.Serialize(v, Options).GetHashCode(),
            v => JsonSerializer.Deserialize<T>(JsonSerializer.Serialize(v, Options), Options)!);

        public static ValueComparer<List<T>> ListComparer<T>() => Comparer<List<T>>();
    }
}

/// <summary>Serializes <see cref="NutrientProfile"/> as a plain {"1008": 120.5, ...} object.</summary>
public sealed class NutrientProfileJsonConverter : System.Text.Json.Serialization.JsonConverter<NutrientProfile>
{
    public override NutrientProfile Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options) =>
        new(JsonSerializer.Deserialize<Dictionary<int, double>>(ref reader, options) ?? new Dictionary<int, double>());

    public override void Write(Utf8JsonWriter writer, NutrientProfile value, JsonSerializerOptions options) =>
        JsonSerializer.Serialize(writer, value.Amounts, options);
}
