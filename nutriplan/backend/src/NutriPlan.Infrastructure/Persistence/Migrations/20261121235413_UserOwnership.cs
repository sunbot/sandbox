using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace NutriPlan.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class UserOwnership : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // 1. Identity tables, and the single "legacy owner" every existing private row is assigned to. Nobody signs in
            //    as this account until the owner explicitly claims it (Auth:OwnerSubject); nothing is deleted or rewritten.

            migrationBuilder.CreateTable(
                name: "app_users",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    display_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    email = table.Column<string>(type: "character varying(320)", maxLength: 320, nullable: true),
                    role = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    is_active = table.Column<bool>(type: "boolean", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    last_login_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_app_users", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "external_identities",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    provider = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    subject = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_external_identities", x => x.id);
                    table.ForeignKey(
                        name: "fk_external_identities_app_users_user_id",
                        column: x => x.user_id,
                        principalTable: "app_users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "invitations",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    email_hash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    invited_by = table.Column<Guid>(type: "uuid", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    expires_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    accepted_by = table.Column<Guid>(type: "uuid", nullable: true),
                    accepted_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    revoked_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_invitations", x => x.id);
                    table.ForeignKey(
                        name: "fk_invitations_app_users_invited_by",
                        column: x => x.invited_by,
                        principalTable: "app_users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.Sql("""
                INSERT INTO app_users (id, display_name, email, role, is_active, created_at, updated_at, last_login_at)
                VALUES ('00000000-0000-4000-8000-0000000000a1', 'Owner', NULL, 'Owner', TRUE, now(), now(), NULL)
                ON CONFLICT (id) DO NOTHING;
                """);

            // 2. Owner columns. Existing rows get the legacy owner through the column default, which is then dropped so
            //    new rows must always name their owner.

            migrationBuilder.DropPrimaryKey(
                name: "pk_targets",
                table: "targets");

            migrationBuilder.DropIndex(
                name: "ix_recipes_origin_external_id",
                table: "recipes");

            migrationBuilder.DropIndex(
                name: "ix_plan_entries_date",
                table: "plan_entries");

            migrationBuilder.DropIndex(
                name: "ix_diary_entries_date",
                table: "diary_entries");

            migrationBuilder.DropColumn(
                name: "id",
                table: "targets");

            migrationBuilder.AddColumn<Guid>(
                name: "owner_id",
                table: "targets",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-4000-8000-0000000000a1"));

            migrationBuilder.AddColumn<Guid>(
                name: "owner_id",
                table: "recipes",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-4000-8000-0000000000a1"));

            migrationBuilder.AddColumn<Guid>(
                name: "owner_id",
                table: "plan_entries",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-4000-8000-0000000000a1"));

            migrationBuilder.AddColumn<Guid>(
                name: "owner_id",
                table: "pantry_items",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-4000-8000-0000000000a1"));

            migrationBuilder.AddColumn<Guid>(
                name: "owner_id",
                table: "foods",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "owner_id",
                table: "diary_entries",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-4000-8000-0000000000a1"));


            migrationBuilder.Sql("""
                ALTER TABLE diary_entries ALTER COLUMN owner_id DROP DEFAULT;
                ALTER TABLE plan_entries ALTER COLUMN owner_id DROP DEFAULT;
                ALTER TABLE recipes ALTER COLUMN owner_id DROP DEFAULT;
                ALTER TABLE pantry_items ALTER COLUMN owner_id DROP DEFAULT;
                ALTER TABLE targets ALTER COLUMN owner_id DROP DEFAULT;
                -- Foods made from a label are private; catalog and cached public products stay shared (owner_id NULL).
                UPDATE foods SET owner_id = '00000000-0000-4000-8000-0000000000a1' WHERE source = 'User';
                """);

            migrationBuilder.AddPrimaryKey(
                name: "pk_targets",
                table: "targets",
                column: "owner_id");

            migrationBuilder.CreateIndex(
                name: "ix_recipes_owner_id_origin_external_id",
                table: "recipes",
                columns: new[] { "owner_id", "origin", "external_id" });

            migrationBuilder.CreateIndex(
                name: "ix_plan_entries_owner_id_date",
                table: "plan_entries",
                columns: new[] { "owner_id", "date" });

            migrationBuilder.CreateIndex(
                name: "ix_pantry_items_owner_id",
                table: "pantry_items",
                column: "owner_id");

            migrationBuilder.CreateIndex(
                name: "ix_foods_owner_id",
                table: "foods",
                column: "owner_id");

            migrationBuilder.CreateIndex(
                name: "ix_diary_entries_owner_id_date",
                table: "diary_entries",
                columns: new[] { "owner_id", "date" });

            migrationBuilder.CreateIndex(
                name: "ix_external_identities_user_id",
                table: "external_identities",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "ux_external_identities_provider_subject",
                table: "external_identities",
                columns: new[] { "provider", "subject" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_invitations_email_hash",
                table: "invitations",
                column: "email_hash");

            migrationBuilder.CreateIndex(
                name: "ix_invitations_invited_by",
                table: "invitations",
                column: "invited_by");

            migrationBuilder.AddForeignKey(
                name: "fk_diary_entries_app_users_owner_id",
                table: "diary_entries",
                column: "owner_id",
                principalTable: "app_users",
                principalColumn: "id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "fk_foods_app_users_owner_id",
                table: "foods",
                column: "owner_id",
                principalTable: "app_users",
                principalColumn: "id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "fk_pantry_items_app_users_owner_id",
                table: "pantry_items",
                column: "owner_id",
                principalTable: "app_users",
                principalColumn: "id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "fk_plan_entries_app_users_owner_id",
                table: "plan_entries",
                column: "owner_id",
                principalTable: "app_users",
                principalColumn: "id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "fk_recipes_app_users_owner_id",
                table: "recipes",
                column: "owner_id",
                principalTable: "app_users",
                principalColumn: "id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "fk_targets_app_users_owner_id",
                table: "targets",
                column: "owner_id",
                principalTable: "app_users",
                principalColumn: "id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Rolling back merges every account's rows into one unowned set, so it is only allowed while the legacy owner
            // is the only one with data. After other people have signed up, restore the pre-migration backup instead.
            migrationBuilder.Sql("""
                DO $$
                BEGIN
                    IF EXISTS (SELECT 1 FROM diary_entries WHERE owner_id <> '00000000-0000-4000-8000-0000000000a1')
                       OR EXISTS (SELECT 1 FROM plan_entries WHERE owner_id <> '00000000-0000-4000-8000-0000000000a1')
                       OR EXISTS (SELECT 1 FROM recipes WHERE owner_id <> '00000000-0000-4000-8000-0000000000a1')
                       OR EXISTS (SELECT 1 FROM pantry_items WHERE owner_id <> '00000000-0000-4000-8000-0000000000a1')
                       OR EXISTS (SELECT 1 FROM targets WHERE owner_id <> '00000000-0000-4000-8000-0000000000a1')
                       OR EXISTS (SELECT 1 FROM foods WHERE owner_id IS NOT NULL AND owner_id <> '00000000-0000-4000-8000-0000000000a1') THEN
                        RAISE EXCEPTION 'UserOwnership rollback refused: accounts other than the legacy owner have data. Restore the pre-migration backup instead.';
                    END IF;
                END $$;
                """);

            migrationBuilder.DropForeignKey(
                name: "fk_diary_entries_app_users_owner_id",
                table: "diary_entries");

            migrationBuilder.DropForeignKey(
                name: "fk_foods_app_users_owner_id",
                table: "foods");

            migrationBuilder.DropForeignKey(
                name: "fk_pantry_items_app_users_owner_id",
                table: "pantry_items");

            migrationBuilder.DropForeignKey(
                name: "fk_plan_entries_app_users_owner_id",
                table: "plan_entries");

            migrationBuilder.DropForeignKey(
                name: "fk_recipes_app_users_owner_id",
                table: "recipes");

            migrationBuilder.DropForeignKey(
                name: "fk_targets_app_users_owner_id",
                table: "targets");

            migrationBuilder.DropTable(
                name: "external_identities");

            migrationBuilder.DropTable(
                name: "invitations");

            migrationBuilder.DropTable(
                name: "app_users");

            migrationBuilder.DropPrimaryKey(
                name: "pk_targets",
                table: "targets");

            migrationBuilder.DropIndex(
                name: "ix_recipes_owner_id_origin_external_id",
                table: "recipes");

            migrationBuilder.DropIndex(
                name: "ix_plan_entries_owner_id_date",
                table: "plan_entries");

            migrationBuilder.DropIndex(
                name: "ix_pantry_items_owner_id",
                table: "pantry_items");

            migrationBuilder.DropIndex(
                name: "ix_foods_owner_id",
                table: "foods");

            migrationBuilder.DropIndex(
                name: "ix_diary_entries_owner_id_date",
                table: "diary_entries");

            migrationBuilder.DropColumn(
                name: "owner_id",
                table: "targets");

            migrationBuilder.DropColumn(
                name: "owner_id",
                table: "recipes");

            migrationBuilder.DropColumn(
                name: "owner_id",
                table: "plan_entries");

            migrationBuilder.DropColumn(
                name: "owner_id",
                table: "pantry_items");

            migrationBuilder.DropColumn(
                name: "owner_id",
                table: "foods");

            migrationBuilder.DropColumn(
                name: "owner_id",
                table: "diary_entries");

            migrationBuilder.AddColumn<int>(
                name: "id",
                table: "targets",
                type: "integer",
                nullable: false,
                defaultValue: 1); // the old single-row key (NutritionTargets.SingletonId)

            migrationBuilder.AddPrimaryKey(
                name: "pk_targets",
                table: "targets",
                column: "id");

            migrationBuilder.CreateIndex(
                name: "ix_recipes_origin_external_id",
                table: "recipes",
                columns: new[] { "origin", "external_id" });

            migrationBuilder.CreateIndex(
                name: "ix_plan_entries_date",
                table: "plan_entries",
                column: "date");

            migrationBuilder.CreateIndex(
                name: "ix_diary_entries_date",
                table: "diary_entries",
                column: "date");
        }
    }
}
