# Intake Grid — Status Report for Independent Review

**Prepared:** 2026-11-22 · **Repository:** `sunbot/sandbox`, app in `nutriplan/` · **Default branch:** `master` (auto-deployed)

This report is meant to be reviewed by someone who has not seen the project. It says what the product is, how it is built, what changed in the last three days, how it was verified, and what is still unverified or risky. Where something was **not** verified, it says so. Please challenge anything that looks under-tested, over-claimed or poorly justified. Section 11 lists specific questions.

---

## 1. What the product is

**Intake Grid** (code name *NutriPlan*) is a personal nutrition and meal-planning app for one owner plus a few invited people. It logs food (typed, spoken, scanned or searched), plans a week of meals, imports and scales recipes, shows nutrient progress, and suggests what to eat to fill what is missing from the day.

Platforms: an Android app (APK) and a web app, both from one Expo/React Native codebase. The web app is served by the same API and is used daily by the owner, so it must keep working.

Principles that drive decisions (from the project's `CLAUDE.md`):
- Every number comes from a stored food record, a user-entered label, or a deterministic calculation. **A language model may parse text but never supplies nutrition.**
- Unknown stays unknown (never treated as zero). Raw vs cooked and mass vs volume are never confused. No invented gram weights or densities.
- History is stable: diary and plan entries store a nutrition snapshot, so editing or deleting a food or recipe never rewrites the past.
- No production data is changed without explicit approval; every merge needs the owner's say-so.

## 2. Architecture

```
 Android app (Expo SDK 58, APK built by GitHub Actions)      Web app (same code, served by the API)
                      \                                          /
                       \------------- HTTPS, Google sign-in ----/
                                       |
 +----------------- API service on Render (.NET 10, Docker image built from master) -----------------+
 |  Api            minimal endpoints, validation, error mapping, rate limits                         |
 |  Application    use cases/services (Food, Diary, Plan, Recipes, Insights, GapFill, Assistant)     |
 |  Infrastructure EF Core + Npgsql, USDA importer/enricher, USDA Branded, Open Food Facts, Claude   |
 |  Domain         dependency-free rules: nutrients, units, quantities, planning, gap recommender    |
 +----------------------------------------------------------------------------------------------------+
        |                    |                         |                        |
   Postgres (Neon)     USDA FoodData Central      Open Food Facts         Claude (optional)
   foods, recipes,     (bulk import + live        (barcodes only)         parses Ask text only
   diary/plan          branded search)
   snapshots
```

Layering is strict: dependencies point inward to Domain. Endpoints are thin. Business rules are not in endpoints or UI.

**Size (this repo, non-generated source):** Domain ≈ 2.9k lines, Application ≈ 4.3k, Infrastructure ≈ 5.3k, Api ≈ 0.6k, backend tests ≈ 5.6k, mobile app ≈ 10.7k, browser tests ≈ 0.5k. About 67 HTTP endpoints, 4 EF migrations, 13 mobile screens/routes. 119 commits; 21 pull requests merged since 2026-11-20 (#33–#51).

**Accounts and isolation:** Google sign-in via Firebase; the API validates the Firebase token and fails closed (no active, invited user → no access). It is invite-only; the owner invites people by email. Every user-owned read and write is scoped by owner in both the repositories and EF query filters; raw SQL must name the owner. Shared data (USDA foods) has no owner. A first-run claim step attaches the pre-existing single-user data to the configured owner.

**Deployment:** Render builds the Docker image from `master` and deploys automatically; migrations run at startup. The database is Neon Postgres. APKs are built by a manually started GitHub Actions workflow and published to a mutable `android-latest` release.

## 3. Timeline of what happened

Dates are 2026-11-20 to 11-22. "Owner" is the project's one real user.

| PR | Date | What shipped |
|---|---|---|
| #33–#41 | 11-20/21 | Reliability review of Ask parsing and raw/cooked handling; recipe detail redesign; nutrients screen (overview + heatmap); Claude request-schema fix (every Ask had silently fallen back to the built-in rules); barcode "not found" vs temporary failure; USDA Branded live search with caching; weekly calorie chart; Today redesign |
| #42 | 11-21 | **Google sign-in, invite-only accounts, per-user data isolation** (Firebase). Owner walked through Firebase setup; owner skipped a pre-migration backup because the data was test data |
| #43 | 11-22 | **Fill the Gaps V2:** deterministic recommender (real portions only, hard constraints, nothing added when at/over target) |
| #44 | 11-22 | **Food logging UX:** `FoodMeasures` (real measures per food), amount/unit editing, shared quantity picker, swipe-to-delete, scanner zoom/torch/manual entry |
| #45 | 11-22 | **USDA measurements:** phrase labels ("100-calorie package"), safe borrowing of portions for Foundation foods that have none, small search boost for measurable foods |
| #46 | 11-22 | **"Show different ideas"** (deterministic rotation through the recommender's other qualifying ideas) |
| #47 | 11-22 | Web barcode scanner rebuilt for Android Chrome; a swipe-to-delete attempt; opt-in switch to run the USDA portions step on an existing database |
| #48 | 11-22 | **Swipe row rebuilt on React Native's own touch system** (fixed the Android tap/delete bug) |
| #49 | 11-22 | Macro bars over target say "N g over" (the bar looked stuck once past 100%) |
| #50 | 11-22 | **Regression test program:** pure-logic modules + 17 browser tests + guard test + new CI job |
| #51 | 11-22 | Docs: scanner fix confirmed on a phone |

Production-data actions this period: the USDA portions step was run in production by the owner (see §5.3) after a dry run; nothing else touched production data.

## 4. Verification, honestly stated

**Automated (all passing on `master`):**

| Suite | Count | Notes |
|---|---|---|
| Backend: Domain | 199 | pure logic |
| Backend: Application | 268 | services against an in-memory store |
| Backend: Infrastructure | 61 | includes real-Postgres integration tests |
| Backend: API | 11 | auth, isolation, per-user scoping |
| Mobile unit tests | 137 | Node test runner on pure TypeScript modules |
| Browser regression tests | 17 | Playwright + Chromium, every API call mocked |
| Plus | | TypeScript, lint, web export, EF "no pending model changes" in CI |

**CI:** GitHub Actions runs backend (with a real Postgres service), app (typecheck, lint, tests, web export) and browser tests on every push and PR. The Render deploy hook waits for all three. The APK workflow does **not** wait for CI.

**Reviews:** each larger change got an independent review by a separate, fresh-context agent. Reviews found real issues each time (examples in §6). This is model-based review, not human review.

**On-device confirmation by the owner (real phone):** Android APK — tapping a logged food opens the editor; swipe reveals Delete and it deletes with Undo (after two failed fixes, see §6). Android Chrome — the web barcode scanner is sharp and reads barcodes. Production — the USDA portions step ran (49 foods updated).

**Not verified (important):**
- No Android emulator or device was available to the developer; Android-specific behaviour was only ever confirmed by the owner testing builds. A browser can't reproduce the Android swipe/tap bug, so its regression coverage is a **source-level guard test** (§7), which is weaker than a real device test.
- The scanner was verified with a **simulated** camera stack and detector in tests; real sharpness is confirmed only on one phone (a Pixel in Chrome). Other phones/browsers, and Safari/Firefox (which use the old scanner path), are unverified.
- Android Google sign-in still uses the Expo **debug** signing key (see §8).
- Production behaviour of recent releases beyond the owner's own use has not been checked by any monitoring.

## 5. The larger features, with decisions and trade-offs

### 5.1 Fill the Gaps (recommender) and "Show different ideas"
Deterministic, no model. The day is classified (room for a meal / a snack / at target / over). Candidates are real portions of saved recipes, pantry foods, foods the user eats, and a few staples, assembled into meals (a main + sides) or snacks (compatible pairs) and kept only if they fit the calories left, never push an exceeded limit further, and every item covers a meaningful share of something missing. At/over target nothing is added; lighter swaps and next-day ideas are offered instead.

"Show different ideas" reuses the same engine. Each idea has a stable id (hash of its sorted food/recipe keys, so reordered ingredients are the same idea). The app sends back the ids already shown; the server skips them and orders ideas led by an already-shown lead after fresh ones. Foods already logged or planned that day are not suggested. Skipped ideas are tracked **per filter** (a review caught a shared list that would have emptied other filters).
*Trade-off/limit:* meals and pairs are built from the 10 most relevant candidates per kind, so "no more ideas" means within that bounded search, not exhaustive.

### 5.2 Logging and measures
`FoodMeasures` derives the measures a food can really be logged in (count items from its own portions, cup/tbsp/tsp only via a volume USDA measured for that food, g/oz exact; drinks per 100 ml never get grams). `ItemAmounts` edits an entry's amount/unit by scaling its **own snapshot**, so history stays stable. One quantity picker serves every screen.

### 5.3 USDA measurements and the production data step
**Finding:** a whole raw almond food had no measures because USDA's own data has none for it (not an import bug). USDA links it (shared NDB number) to an SR Legacy record that has almond and cup measures.
**Fix:** `EquivalentPortions` copies the linked record's portions onto a Foundation food that has **none**, only when names show the same food (the Foundation name may add only raw/whole/halves/kernels; numbers must match, so 90% lean ≠ 80% lean) and each portion fits the food's cut (whole almonds get "cup, whole", never "cup, sliced/ground"). Weights are copied unchanged, each borrowed portion records its origin and the app shows it. Nutrition, names and ids are untouched; the step is idempotent.
**Result:** 49 of 115 linked foods qualified; 66 were deliberately left alone because equivalence can't be shown by name (e.g. "Cabbage, green, raw" vs "Cabbage, raw").
**Production:** the database is not reachable from the dev sandbox, so a startup switch (`Usda__EnrichPortions=dry-run|apply`) lets the server do it. The owner ran a dry run, read the log (49 of 115), then applied it. Undo SQL is documented.
**Known imperfections accepted:** two copied USDA portions are odd (a ground-turkey "serving (cooked from 4 oz)" = 85 g on a raw food; a yogurt "container (4 oz)" = 226 g). Both come from USDA's own SR records unchanged; the owner was told and chose to proceed.

Also: portions whose description starts with a number are now named by their phrase ("100 calorie package" → "100-calorie package"; the label sent is the label shown and resolves to the same portion), "calorie"/"NFS" are never measures, and portions that start with a weight ("oz, NFS") are no longer shown as items. A small search boost (+2) favours foods with a real measure; it is smaller than raw/cooked, source-trust and history signals.

### 5.4 Web barcode scanner
**Finding (from the library source and a Chromium measurement):** `expo-camera` on web requests only `facingMode: environment`, so Chrome returns its default 640×480 stretched to full screen, never applies a focus mode (its converter drops `'continuous'`), and cannot pick a lens.
**Fix:** a platform split. Android/iOS keep `expo-camera` unchanged. On web, when the browser has `BarcodeDetector`, the camera is opened directly: ideal 1920×1080 (looser retries), continuous focus only if the camera reports it, other rear lenses tried once and only if the default reports focus modes without continuous, zoom (max 2×) and torch only when supported. Browsers without `BarcodeDetector` use the previous scanner unchanged. No new dependency. Confirmed sharp by the owner on a Pixel in Chrome.

## 6. Problems encountered (and how they were resolved)

These are the incidents most relevant to judging process quality.

1. **Android tap/delete bug — three attempts.** After PR #44 the owner reported logged foods couldn't be edited or deleted on the APK (the web worked). Attempt 1 (use gesture-handler's `Pressable`) changed nothing. Attempt 2 (make the swipe itself delete) "worked" for delete but the owner said it deleted too eagerly and tapping a food still didn't open the editor. Root cause (strongest explanation, never proven with a debugger): taps inside gesture-handler's `ReanimatedSwipeable` never arrived on that phone while swiping did. Attempt 3 replaced it with React Native's `PanResponder` + `Pressable`; the owner confirmed it works. **Lesson:** two fixes were shipped on a guess because no Android device was available; an APK was built from the branch for the owner to test before merging the third.
2. **A wrong first diagnosis.** A screenshot was initially read as an iPhone; the owner corrected this (it was Android). Cost: one round trip.
3. **The scanner review found a real leak** (a timer and stream left running if the screen was left mid-open) plus robustness issues; fixed before release.
4. **An exact-unit-matching change would have silently changed weights** for eight foods (e.g. "2 slices" of a pickle loaf: 38 g → 28.5 g per unit) — caught by an independent review that diffed 13 million food/unit combinations, then restricted.
5. **The ranker/review loop:** the first "Show different ideas" shared one skipped list across filters, a UX bug found by review, fixed and now covered by a test.
6. **A regression introduced and caught mid-task:** changing the diary row to gesture-handler's `Pressable` broke clicks on web; caught by re-running the browser test, then gated to native.
7. **A user-facing display issue misread as a data bug:** "fat doesn't go up past a point" was only the macro bar capping at 100%. A backend test proved the numbers scale; the UI now says "N g over".

## 7. Regression-test program (PR #50)

Goal: every bug fixed in the last two days has a test.
- **Pure logic moved out of screens** (no behaviour change): swipe decisions, per-filter skipped ideas, the over-target amount, camera constraint/selection logic.
- **Browser suite** (`mobile/e2e`, 17 tests): editing and saving; swipe never deletes by itself; tap-away closes without opening the editor; Delete → Undo → single server delete after the window; short/vertical drags don't open a row; "25 g over"; scanner request, lens swap, focus/zoom/torch, looser retry, denied/none/busy messages with manual entry, fallback unchanged, one lookup despite repeated detections, camera released on leaving; "Show different ideas" no repeats, end state, Start over, per-filter lists.
- **Guard test for the Android bug:** a source-level test fails if the diary row imports gesture-handler or if anything other than the Delete button/accessibility action can delete. This is a *proxy* — a browser can't reproduce the Android failure.
- **Mutation check:** four past bugs were deliberately reintroduced (delete-on-swipe, shared skipped list, no over-target text, camera request with no size). Each made the matching tests fail (6 browser + 2 unit), then was reverted.
- **CI:** a new job runs the browser suite on every PR; the deploy hook waits for it. `CLAUDE.md` now requires a regression test with every bug fix.

## 8. Risks, weaknesses and open items

Ordered roughly by how much I'd worry:

1. **Signing key.** The APK is signed with the Expo template debug key, the APK workflow doesn't wait for CI and overwrites a mutable `android-latest` release. Moving to a protected key forces a one-time reinstall for the owner. Android Google sign-in depends on that key's SHA-1.
2. **No Android test automation.** All Android-only behaviour relies on the owner testing a build. The guard test is a stopgap. A device farm or emulator job would be the real fix.
3. **Single-instance assumptions.** The idempotency store and search caches are in memory (one Render instance). A durable unique index on plan→diary links is the real guard for the most important case.
4. **Daily nutrient totals add known values only.** Foods missing a nutrient are counted per nutrient and the app marks totals as minimums (≥), but the user can't yet see *which* foods are the gap.
5. **Search quality for brands/restaurants.** No restaurant provider; USDA's own brand ordering is weak (e.g. a protein shake brand is listed under another brand name).
6. **Ask quantities.** A unitless amount of a food whose only portion is a size (e.g. "a coffee") resolves to a guessed size (480 g) labelled as given; it should ask.
7. **Model-only reviews.** Independent review was by another model instance with fresh context; there has been no human code review, security review beyond a model-run one, or penetration test.
8. **Production observability.** No monitoring or alerting beyond Render logs; the owner is also the QA team.
9. **USDA "borrowed" measures** carry a small residual risk: 49 foods now have portions that came from a different (linked) record, including two odd ones noted in §5.3.
10. **Swipe on desktop:** a desktop mouse drag doesn't open the swipe row (Delete is also in the editor).

## 9. How decisions were made

- **Smallest safe change.** Repeatedly preferred a focused fix over a rewrite (e.g. reuse the recommender for rotation instead of a second engine; reuse the quantity resolver instead of a matching framework). The two exceptions were rebuilding the swipe row and the web scanner camera, each justified by evidence in the library source.
- **Evidence before claims.** Root causes were checked against raw data (USDA CSVs, a local copy of the production-equivalent food database) or library source where possible, and reported as "strongest explanation" where they could not be proven.
- **Approval gates respected.** The production data step needed the owner's approval and was run by the owner after a dry run. Merges followed the owner's explicit instruction ("merge", "when you're done please merge"). Test APKs were built from branches so the owner could verify before merging risky changes.
- **No secrets in the repo.** Credentials are environment variables on the host and repository variables; nothing sensitive is committed. (This report deliberately omits identifiers such as account IDs, project IDs and database hosts.)

## 10. Current state

- `master` is green. Open PRs: #55 and #59 from Copilot (see 10a). Deployed on Render from `master`.
- The Android APK on the `android-latest` release was last built from the branch that became PR #48; the web app (served from Render) includes everything through PR #51. Later changes (macro "over" text, regression tests) are in the web app but not in the owner's installed APK unless a newer APK is built.
- The owner confirmed on real devices: Android edit/delete, Chrome scanner, and the production portions step.
- Remaining owner-side action: confirm the temporary `Usda__EnrichPortions` setting is removed in Render, and spot-check "Almonds, whole, raw" in the app.

Candidate next work (not started): protected signing key and CI-gated APK releases; showing which foods cause a missing-nutrient total; branded/restaurant search; making Ask confirm guessed sizes; broader device testing.

## 10a. Update (evening of 2026-11-22): work by other agents

After this report's first version, the owner had GitHub Copilot (and ChatGPT-drafted issues) work in parallel. What landed and how it was checked:

| PR | Author | State | Notes |
|---|---|---|---|
| #56 | Copilot | merged | "View nutrition" in the logged-item editor: shows the saved snapshot (not the food's current values); missing = "Not reported", a real zero stays 0. Unit + browser tests; CI passed after one fixture fix. Reviewed: consistent with the nutrition invariants; list scrolls on tall and short screens (web). |
| #57 | Copilot | merged | Contains only an empty "Initial plan" commit, yet it closed issue #54 as completed. The real feature is #58/#59. |
| #55 | Copilot | open | Fixed-height editor so opening the measure list doesn't move the header; list scrolls inside. **No CI ever ran** (workflow runs `action_required`); run locally instead: 139 unit, typecheck, lint, 19 browser tests pass. Trade-off: the editor is always 90% tall (large empty space when the list is closed); nested scrolling on Android unverified. Owner decision pending. |
| #59 | Copilot | draft, in progress | Ask review: include/exclude toggle per food, add a food from search, "Log N selected". Draft logic and tests reviewed (immutable updates, stable keys, excluded rows don't block). Server idempotency hashes key + body, so a changed selection is a new request. Passes locally (141 unit, 19 browser). At 360 px the added toggle makes long names wrap to three lines. |
| (Claude) | this session | PR | Fixed a shared `SearchField` layout bug found during review: on web the input had no `minWidth: 0`, so at 320-360 px its clear button spilled out of the field. New browser test covers 320/360/393 px. |

New process notes: Copilot PRs need their workflows approved before CI runs (now in `CLAUDE.md`); several agents editing the same files caused a merge conflict on #55; an issue was closed by a PR that delivered no code.

## 11. Questions for the reviewer

1. Is the **source-level guard test** a reasonable stand-in for an Android-only failure, or would you push for emulator/device automation before more Android work?
2. Does the **borrowing rule** (same NDB link + name subset + cut compatibility) seem sound for nutrition data? Is copying USDA's own odd portions unchanged the right call, or should odd ones be filtered?
3. Is the **"never delete by swipe, only by button + Undo"** design a good default, given the earlier on-device failures and a user complaint about auto-delete?
4. Given a single owner doing QA, what **monitoring/alerting** would you add first?
5. Any gaps in the **invite-only/per-user isolation** design (owner-scoped repositories + EF query filters + fail-closed fallback policy)?
6. What would you prioritize next from §10, and what is missing from this list?
7. Is the **process** (small PRs, independent model review, mutation-checked tests, owner approval gates) proportionate, or is anything under-protected?

*Evidence behind any statement here can be found in `nutriplan/CLAUDE.md`, `nutriplan/docs/` (ARCHITECTURE, AUTH, LOGGING, FILL_THE_GAPS, DEPLOY), the PR descriptions (#33–#51) and `nutriplan/mobile/e2e/README.md`.*
