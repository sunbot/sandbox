using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace NutriPlan.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class RecipeFinishedVolume : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<double>(
                name: "finished_volume_ml",
                table: "recipes",
                type: "double precision",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "finished_volume_ml",
                table: "recipes");
        }
    }
}
