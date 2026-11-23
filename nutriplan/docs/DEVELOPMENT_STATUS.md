# Intake Grid — Development Status

Updated after every meaningful increment. The requirements live in `docs/PRODUCT_ROADMAP.md`; this file says where work
stands right now.

## Now

- **Current phase:** Phase 2 — Recipe Editor and Usability (In Progress).
- **Next action:** P2a — add ingredients by search (foods and your recipes) and remove lines.
- **Waiting on the owner:** Android verification of Phase 1 (APK build 23, `c6ba8c0`; checklist `docs/LOGGING.md` item 5),
  then a decision on `stable-recipes-v1`.
- **Blockers:** none. (Live-site checks: this environment can't reach the Render host, so deploys are verified through
  CI plus the owner.)

## Phase log

| Phase | Status | Commits | Tests at last increment |
|---|---|---|---|
| 1 Unified Recipe System | Awaiting Device Verification | `17c48c7`, `765105e`, `0a2bae0`, `c6ba8c0` | backend 288 app · 203 domain · 62 infra · 12 API (Postgres); app unit 151; browser 26; typecheck, lint, web export ✓; CI ✓ |
| 2 Recipe Editor and Usability | In Progress | — | — |

## Builds

| What | Commit | Result |
|---|---|---|
| APK build 23 (`android-latest`) | `c6ba8c0` | ✓ published 2026-11-23 03:02 UTC (APKs are rebuilt only on request) |

## Increment log

- 2026-11-23 — Roadmap reconciled: phase statuses, Phases 2.5 and 2.6 added, this file created.
