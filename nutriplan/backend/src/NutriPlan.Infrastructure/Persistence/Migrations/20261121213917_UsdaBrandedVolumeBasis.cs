using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace NutriPlan.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class UsdaBrandedVolumeBasis : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "basis",
                table: "foods",
                type: "character varying(8)",
                maxLength: 8,
                nullable: false,
                defaultValue: "Mass");

            migrationBuilder.CreateIndex(
                name: "ux_foods_usda_branded_source_id",
                table: "foods",
                column: "source_id",
                unique: true,
                filter: "source = 'UsdaBranded' AND source_id IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ux_foods_usda_branded_source_id",
                table: "foods");

            migrationBuilder.DropColumn(
                name: "basis",
                table: "foods");
        }
    }
}
