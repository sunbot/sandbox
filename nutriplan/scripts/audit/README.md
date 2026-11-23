# Food data audit tools (read-only)

Nothing here writes data. Findings: `docs/FOOD_DATA_QUALITY_AUDIT.md`.

## 1. Database audit

```bash
psql "$URL" -v ON_ERROR_STOP=1 -f scripts/audit/food_data_audit.sql
```

The script runs inside `BEGIN TRANSACTION READ ONLY … ROLLBACK`, so it can't change data. For production, use a
**read-only role** (Neon: create a role with `SELECT` only, or a read-only compute). Only catalogue foods are read, plus
a count of user foods; no diaries.

## 2. Local copy with real USDA data (what the audit was measured on)

```bash
# Download the same files production uses (see Dockerfile, stage "usda") and unzip them, then:
createdb intakegrid_audit
LOCAL=postgres://USER:PASS@localhost:5432/intakegrid_audit
# Set BOTH variables: a nutriplan/.env.local with a production DATABASE_URL would otherwise win.
DATABASE_URL=$LOCAL DATABASE_URL_UNPOOLED=$LOCAL ASPNETCORE_ENVIRONMENT=Development \
  dotnet run -c Release --project backend/src/NutriPlan.Api -- import-usda <foundation dir> <sr legacy dir> <survey dir>
DATABASE_URL=$LOCAL DATABASE_URL_UNPOOLED=$LOCAL ASPNETCORE_ENVIRONMENT=Development \
  dotnet run -c Release --project backend/src/NutriPlan.Api -- enrich-usda-portions <foundation dir> <sr legacy dir> --apply
```

## 3. Ingredient-matching benchmark

```bash
cd backend
NUTRIPLAN_AUDIT_DB='Host=localhost;Username=USER;Password=PASS;Database=intakegrid_audit' \
NUTRIPLAN_AUDIT_OUT=/tmp/matching_benchmark.md \
  dotnet test -c Release tests/NutriPlan.Infrastructure.Tests --filter "FullyQualifiedName~MatchingBenchmark"
```

The lines to match come from `scripts/audit/matching_benchmark.txt`:
- `## Name | servings` starts a recipe.
- Lines starting with `#` are comments.

The test uses the app's own `RecipeService.MatchIngredientsAsync` inside a transaction that is rolled back. It is skipped
unless `NUTRIPLAN_AUDIT_DB` is set, so normal test runs and CI never touch an audit database.
