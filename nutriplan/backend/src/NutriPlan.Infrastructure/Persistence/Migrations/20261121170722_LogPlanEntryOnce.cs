using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace NutriPlan.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class LogPlanEntryOnce : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateIndex(
                name: "ux_diary_entries_plan_entry_id",
                table: "diary_entries",
                column: "plan_entry_id",
                unique: true,
                filter: "plan_entry_id IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ux_diary_entries_plan_entry_id",
                table: "diary_entries");
        }
    }
}
