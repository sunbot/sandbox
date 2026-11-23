# Intake Grid — Development Status

Updated after every meaningful increment. The requirements live in `docs/PRODUCT_ROADMAP.md`; this file says where work
stands right now.

## Now

- **Current phase:** Phase 2 — Recipe Editor and Usability: Implemented, **Awaiting Device Verification**.
- **Phase 2.5** (audit and restaurant strategy): Implemented; awaiting owner review of the findings.
- **Next action:** Phase 2.6, starting with fixes the audit demonstrated (coconut milk variants; recipe matching preferring
  "as purchased" foods over FNDDS cooked dishes; separate coverage, confidence and completeness), each with a regression
  test, and no data migration. Re-matching existing recipes or adding a restaurant provider needs owner approval.
- **Waiting on the owner:** Android checks for Phase 1 (`docs/LOGGING.md` item 5) and Phase 2 (item 6). Phase 2 isn't in an
  APK yet: build 23 predates it, and APKs are rebuilt only on request. Decisions on `stable-recipes-v1` and a Phase 2 tag.
- **Blockers:** none. (Live-site checks: this environment can't reach the Render host, so deploys are verified through
  CI plus the owner.)

## Phase log

| Phase | Status | Commits | Tests at last increment |
|---|---|---|---|
| 1 Unified Recipe System | Awaiting Device Verification | `17c48c7`, `765105e`, `0a2bae0`, `c6ba8c0` | backend 288 app · 203 domain · 62 infra · 12 API (Postgres); app unit 151; browser 26; typecheck, lint, web export ✓; CI ✓ |
| 2.5 Food Data Quality Audit and Restaurant Strategy | Implemented (awaiting review) | (this push) | audit SQL and benchmark run on a local USDA copy; backend suites unchanged |
| 2 Recipe Editor and Usability | Awaiting Device Verification | `ed5dd9a`, `ddff772`, `94cf56b`, review fixes | backend 313 app · 203 domain · 62 infra · 12 API (Postgres); app unit 153; browser 32; typecheck, lint ✓ |

## Builds

| What | Commit | Result |
|---|---|---|
| APK build 23 (`android-latest`) | `c6ba8c0` | ✓ published 2026-11-23 03:02 UTC (APKs are rebuilt only on request) |

## Copilot PRs (checked at the end of Phases 2 and 2.5)

- #65 clear a meal: merged (`176768a`); Android checklist item 7.
- #67 grocery remove/restore: merged (`eeb4c25`) plus tests (`102cc98`). Production gets a new table via an additive migration on deploy.
- #66 bulk-move diary entries: merged at the owner's request once Copilot finished (`bff4a51`): conflicts with #65 resolved, Clear hidden while selecting, a fragile test fixed. Android checklist item 8.

## Blockers / safety notes

- `nutriplan/.env.local` in the dev container holds the production `DATABASE_URL`, which the app prefers over local
  settings. Local CLI runs must set `DATABASE_URL` and `DATABASE_URL_UNPOOLED` explicitly. Owner: consider removing it.
- Production can't be audited from here (no network access; correctly). Run `scripts/audit/food_data_audit.sql` read-only.

## Increment log

- 2026-11-23 — Roadmap reconciled: phase statuses, Phases 2.5 and 2.6 added, this file created (`0dce1a2`).
- 2026-11-23 — Phase 2 API: add/remove/scale (`ed5dd9a`). Note: this push ran while local Postgres was down (DB tests failed
  to connect); re-run with Postgres up: all passed. Pushes now require every suite to pass.
- 2026-11-23 — Phase 2 app: add from search, amounts in real measures, remove, scale (`ddff772`); review flow and logging in
  recipe measures (`94cf56b`).
- 2026-11-23 — Phase 2 independent review: 10 findings fixed with regression tests (two mutation-checked).
- 2026-11-23 — Phase 2.5: read-only audit SQL, matching benchmark, local USDA copy measured; FOOD_DATA_QUALITY_AUDIT.md and
  RESTAURANT_NUTRITION_STRATEGY.md written. Curry reproduced (388 kcal versus 364 reported); coconut milk and sweet potato
  mismatches found.
- 2026-11-23 — End-of-phase Copilot review: #65 and #67 merged after local backend (Postgres), unit and browser runs; #66 left open (WIP).
- 2026-11-23 — Copilot #66 merged into master (`bff4a51`) after resolving conflicts with #65; all suites pass (backend with Postgres, unit, browser 38).
