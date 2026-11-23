# Intake Grid — Development Status

Updated after every meaningful increment. The requirements live in `docs/PRODUCT_ROADMAP.md`; this file says where work
stands right now.

## Now

- **Current phase:** Phase 2 — Recipe Editor and Usability: Implemented, **Awaiting Device Verification**.
- **Next action:** while waiting, Phase 2.5 (read-only data-quality audit and restaurant strategy: documents and audit
  tooling only, no imports or providers).
- **Waiting on the owner:** Android checks for Phase 1 (`docs/LOGGING.md` item 5) and Phase 2 (item 6). Phase 2 isn't in an
  APK yet: build 23 predates it, and APKs are rebuilt only on request. Decisions on `stable-recipes-v1` and a Phase 2 tag.
- **Blockers:** none. (Live-site checks: this environment can't reach the Render host, so deploys are verified through
  CI plus the owner.)

## Phase log

| Phase | Status | Commits | Tests at last increment |
|---|---|---|---|
| 1 Unified Recipe System | Awaiting Device Verification | `17c48c7`, `765105e`, `0a2bae0`, `c6ba8c0` | backend 288 app · 203 domain · 62 infra · 12 API (Postgres); app unit 151; browser 26; typecheck, lint, web export ✓; CI ✓ |
| 2 Recipe Editor and Usability | Awaiting Device Verification | `ed5dd9a`, `ddff772`, `94cf56b`, review fixes | backend 313 app · 203 domain · 62 infra · 12 API (Postgres); app unit 153; browser 32; typecheck, lint ✓ |

## Builds

| What | Commit | Result |
|---|---|---|
| APK build 23 (`android-latest`) | `c6ba8c0` | ✓ published 2026-11-23 03:02 UTC (APKs are rebuilt only on request) |

## Increment log

- 2026-11-23 — Roadmap reconciled: phase statuses, Phases 2.5 and 2.6 added, this file created (`0dce1a2`).
- 2026-11-23 — Phase 2 API: add/remove/scale (`ed5dd9a`). Note: this push ran while local Postgres was down (DB tests failed
  to connect); re-run with Postgres up: all passed. Pushes now require every suite to pass.
- 2026-11-23 — Phase 2 app: add from search, amounts in real measures, remove, scale (`ddff772`); review flow and logging in
  recipe measures (`94cf56b`).
- 2026-11-23 — Phase 2 independent review: 10 findings fixed with regression tests (two mutation-checked).
