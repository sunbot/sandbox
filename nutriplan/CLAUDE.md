# Intake Grid — Claude Code Project Instructions

Applies to `nutriplan/` in `sunbot/sandbox`. Before changes, inspect `README.md`, `docs/ARCHITECTURE.md`, relevant source and tests, and `mobile/AGENTS.md` for mobile work. Keep these instructions consistent with the actual code.

## Product principles

Build a trustworthy, fast, intuitive nutrition and recipe-planning experience. Prioritize nutrition correctness, user data integrity, privacy, accessibility, and responsive Android UX. Preserve the current dark visual design unless asked to change it. Prefer small, coherent improvements over broad rewrites.

## Names, deployment and repo facts

- Product name: **Intake Grid**. Code, folders, namespaces and the DB context keep the original name `NutriPlan`.
- Android package id `com.nutriplan.app` must **never** change: a new id installs as a separate app and existing installs stop updating.
- Render deploys the Docker image from `master` (auto-deploy; the CI deploy-hook job runs only when `RENDER_DEPLOY_HOOK_URL` is set). Production database: Neon Postgres.
- APKs: workflow "Intake Grid Android APK" (`.github/workflows/nutriplan-android.yml`) publishes `IntakeGrid.apk` to the `android-latest` release. CI: `.github/workflows/nutriplan-ci.yml`.

## Architecture

- `backend/src/NutriPlan.Domain`: dependency-free entities and pure rules (nutrition, quantities, weekly budgets, planning).
- `backend/src/NutriPlan.Application`: use cases, services, DTOs, provider interfaces.
- `backend/src/NutriPlan.Infrastructure`: EF Core/PostgreSQL, USDA import, external providers, Claude client.
- `backend/src/NutriPlan.Api`: thin minimal API endpoints, validation and composition.
- `backend/tests`: xUnit domain, application and Postgres integration tests.
- `mobile`: Expo SDK 58, React Native/TypeScript, Expo Router, TanStack Query; keep reusable logic outside route components.

Dependencies point inward. Don't put business rules in endpoints or nutrition calculation in UI. Reuse existing patterns rather than creating unnecessary services or frameworks.

## Mobile UI conventions

- The app is dark-only ("Hearth" palette): tokens in `mobile/src/theme/tokens.ts`, read via `useTheme()`. Don't change palette values without being asked.
- New or redesigned screens use `mobile/src/components/ds`. `src/lib/theme.ts` and `src/components/ui.tsx` are legacy (mirroring the same palette) and go away as screens migrate.
- Icons: Lucide, imported only from `src/components/ds/icons.ts` (per-icon paths; importing the package root is lint-blocked, ~2.3 MB). 20–22 dp, muted by default; accent only for meaningful emphasis. No emoji as UI icons (user-entered content keeps its emoji).
- Status is never shown by color alone (icon/word/number too); touch targets ≥ 48 dp; support large font scales.
- The web build must keep working (the owner uses it daily). `Alert.alert` does nothing on web: never rely on it for essential actions or feedback; use sheets, inline messages or the snackbar.

## Nutrition invariants — non-negotiable

1. Language models may parse requests and propose recipes but MUST NOT supply invented nutrition data. Numbers must come from traceable database entries, user-entered labels or deterministic calculations.
2. Preserve source and quality metadata; unknown nutrient values must remain unknown, not be treated as zero.
3. Distinguish per-100-g from per-serving, kcal from kJ, mg from mcg, raw from cooked, and mass from volume. Never invent a density or gram weight to make a restaurant item fit the model.
4. Keep diary and plan nutrition snapshots stable when foods or recipes are changed.
5. Show unmatched or ambiguous ingredients and amounts for user confirmation. Do not silently rewrite historical logs.
6. Preserve provenance and comply with commercial provider terms, storage, caching, and attribution conditions.

## Workflow for nontrivial work

1. Inspect relevant implementation and tests, including API contracts and database migrations.
2. Propose a brief implementation plan with user outcome, acceptance criteria, impacted areas, risks, edge cases, and verification steps. Request approval for destructive operations or breaking changes.
3. Implement one bounded vertical slice. Avoid unrelated refactors and style churn.
4. Add unit or integration tests for changed behavior; for bug fixes, reproduce with a regression test when feasible.
5. Run relevant builds, tests, type checks, lint and exports. Verify actual Android behavior for UI/native changes when possible.
6. Perform a fresh-context or independent review focused on correctness, security, nutrition semantics, regressions and scope.
7. Report files changed, tests actually run and their results, caveats, and remaining risks. Never claim verification you did not perform.

For a tiny UI-only change, keep the process lightweight.

## Validation commands

From `nutriplan/backend`:

```bash
dotnet restore
dotnet build -c Release
dotnet test -c Release
# With disposable Postgres available:
# NUTRIPLAN_TEST_DB='Host=localhost;Username=nutriplan;Password=...;Database=postgres' dotnet test -c Release
# For EF changes:
dotnet tool restore
dotnet ef migrations has-pending-model-changes --project src/NutriPlan.Infrastructure --startup-project src/NutriPlan.Api
```

PostgreSQL tests skipped due to an absent `NUTRIPLAN_TEST_DB` are NOT proof those tests passed. Test migrations against disposable Postgres and document production upgrade/rollback implications.

From `nutriplan/mobile`:

```bash
npm ci
npm run typecheck
npm run lint
npx expo export --platform web
npx expo-doctor
```

Check current version-specific Expo SDK 58 documentation for native APIs and use `npx expo install` for compatible dependencies. Validate Android permission flows, barcode and voice features, loading/error/empty states, accessibility and smaller devices.

## Security and operational safety

- Never check in credentials, actual user diaries, API keys, secrets, or personal data. Never put backend secrets in `EXPO_PUBLIC_*` variables.
- Treat the optional shared API key as **local/single-user only**; publicly exposed deployments must fail closed without configured protection. Implement true authentication and per-user authorization/isolation before serving multiple users.
- The current app stores the API key in AsyncStorage; move sensitive native credentials to appropriate secure storage before public release.
- Hosted API access should use HTTPS, bounded inputs, sensible rate limits and safe errors. Preserve anti-SSRF controls in `HttpWebPageFetcher`.
- Preserve/verify backups and use controlled, reversible database migrations. Avoid destructive operations and do not alter production data without explicit approval.
- Use feature branches/PRs where possible. Do not publish a release APK until required CI checks pass; use versioned immutable artifacts and protected signing keys.
- The repo's default branch is `master`: verify actual deployment and CI branch names rather than assuming `main`.

## Food database extensions

Keep the USDA importer and Open Food Facts barcode fallback. The existing `IBarcodeProvider` is barcode-only; introduce a separate provider abstraction for restaurant/branded text search. Normalize external data and source identity at the boundary. Support serving-based restaurant items explicitly where gram weight is unknown rather than fabricating mass. Define caching/licensing constraints per provider. Evaluate search changes using representative ingredient, branded, restaurant, synonym and misspelling queries; track result relevance and latency.

## Known gaps against these rules (keep this list current)

- `ApiKeyMiddleware` allows all requests when `Api:Key` is unset (fails open). Requiring a key needs coordinating with the Render config and the app's Settings first.
- The APK workflow doesn't wait for CI, overwrites the mutable `android-latest` release, and signs with the Expo template debug key. Moving to a protected key forces a one-time reinstall.
- Daily nutrient totals still add known values only; entries missing a nutrient are counted per nutrient (`missingFrom`) and the app marks those totals as minimums (≥). Weekly heatmap averages don't flag this yet.
- The API key is stored in AsyncStorage (not secure storage).

## Definition of done

Relevant acceptance criteria met; nutrition/data invariants preserved; error paths covered; appropriate tests and build checks passed or explicitly noted as unrun; migration and backward-compatibility risks identified; concise change summary supplied; docs updated when behavior changes.
