using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace NutriPlan.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class InitialCreate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterDatabase()
                .Annotation("Npgsql:PostgresExtension:pg_trgm", ",,");

            migrationBuilder.CreateTable(
                name: "diary_entries",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    date = table.Column<DateOnly>(type: "date", nullable: false),
                    meal = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    item = table.Column<string>(type: "jsonb", nullable: false),
                    plan_entry_id = table.Column<Guid>(type: "uuid", nullable: true),
                    note = table.Column<string>(type: "text", nullable: true),
                    logged_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_diary_entries", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "foods",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(400)", maxLength: 400, nullable: false),
                    brand = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    source = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    source_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    barcode = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    category = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    quality = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    quality_note = table.Column<string>(type: "character varying(400)", maxLength: 400, nullable: true),
                    nutrients_per100g = table.Column<string>(type: "jsonb", nullable: false),
                    is_archived = table.Column<bool>(type: "boolean", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    portions = table.Column<string>(type: "jsonb", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_foods", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "pantry_items",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    food_id = table.Column<Guid>(type: "uuid", nullable: true),
                    grams = table.Column<double>(type: "double precision", nullable: true),
                    expires_on = table.Column<DateOnly>(type: "date", nullable: true),
                    is_staple = table.Column<bool>(type: "boolean", nullable: false),
                    added_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_pantry_items", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "plan_entries",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    date = table.Column<DateOnly>(type: "date", nullable: false),
                    meal = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    item = table.Column<string>(type: "jsonb", nullable: false),
                    status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    batch_id = table.Column<Guid>(type: "uuid", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_plan_entries", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "recipes",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    servings = table.Column<double>(type: "double precision", nullable: false),
                    serving_description = table.Column<string>(type: "text", nullable: true),
                    origin = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    external_id = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    source_name = table.Column<string>(type: "text", nullable: true),
                    source_url = table.Column<string>(type: "text", nullable: true),
                    description = table.Column<string>(type: "text", nullable: true),
                    directions = table.Column<string>(type: "text", nullable: true),
                    notes = table.Column<string>(type: "text", nullable: true),
                    prep_time = table.Column<string>(type: "text", nullable: true),
                    cook_time = table.Column<string>(type: "text", nullable: true),
                    total_time = table.Column<string>(type: "text", nullable: true),
                    image_url = table.Column<string>(type: "text", nullable: true),
                    photo = table.Column<byte[]>(type: "bytea", nullable: true),
                    rating = table.Column<int>(type: "integer", nullable: true),
                    cooked_weight_grams = table.Column<double>(type: "double precision", nullable: true),
                    source_nutrition_text = table.Column<string>(type: "text", nullable: true),
                    is_favorite = table.Column<bool>(type: "boolean", nullable: false),
                    nutrition_per_serving = table.Column<string>(type: "jsonb", nullable: false),
                    nutrition_coverage = table.Column<double>(type: "double precision", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    categories = table.Column<string>(type: "jsonb", nullable: false),
                    ingredients = table.Column<string>(type: "jsonb", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_recipes", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "targets",
                columns: table => new
                {
                    id = table.Column<int>(type: "integer", nullable: false),
                    calories = table.Column<double>(type: "double precision", nullable: false),
                    protein_grams = table.Column<double>(type: "double precision", nullable: false),
                    carb_grams = table.Column<double>(type: "double precision", nullable: false),
                    fat_grams = table.Column<double>(type: "double precision", nullable: false),
                    budget_mode = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    week_starts_on = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    max_daily_adjustment = table.Column<double>(type: "double precision", nullable: false),
                    nutrient_overrides = table.Column<string>(type: "jsonb", nullable: false),
                    focus_nutrients = table.Column<string>(type: "jsonb", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_targets", x => x.id);
                });

            migrationBuilder.CreateIndex(
                name: "ix_diary_entries_date",
                table: "diary_entries",
                column: "date");

            migrationBuilder.CreateIndex(
                name: "ix_foods_barcode",
                table: "foods",
                column: "barcode");

            migrationBuilder.CreateIndex(
                name: "ix_foods_name_trgm",
                table: "foods",
                column: "name")
                .Annotation("Npgsql:IndexMethod", "gin")
                .Annotation("Npgsql:IndexOperators", new[] { "gin_trgm_ops" });

            migrationBuilder.CreateIndex(
                name: "ix_foods_source_source_id",
                table: "foods",
                columns: new[] { "source", "source_id" });

            migrationBuilder.CreateIndex(
                name: "ix_plan_entries_batch_id",
                table: "plan_entries",
                column: "batch_id");

            migrationBuilder.CreateIndex(
                name: "ix_plan_entries_date",
                table: "plan_entries",
                column: "date");

            migrationBuilder.CreateIndex(
                name: "ix_recipes_name_trgm",
                table: "recipes",
                column: "name")
                .Annotation("Npgsql:IndexMethod", "gin")
                .Annotation("Npgsql:IndexOperators", new[] { "gin_trgm_ops" });

            migrationBuilder.CreateIndex(
                name: "ix_recipes_origin_external_id",
                table: "recipes",
                columns: new[] { "origin", "external_id" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "diary_entries");

            migrationBuilder.DropTable(
                name: "foods");

            migrationBuilder.DropTable(
                name: "pantry_items");

            migrationBuilder.DropTable(
                name: "plan_entries");

            migrationBuilder.DropTable(
                name: "recipes");

            migrationBuilder.DropTable(
                name: "targets");
        }
    }
}
