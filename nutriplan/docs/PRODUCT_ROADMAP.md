# Intake Grid — Product Roadmap

Personal-use app shared with a small group of invited users. Priorities: rapid development, immediate testing,
maintainability, and nutrition accuracy. Commercialization may be considered later.

**Workflow:** work directly on `master`, test before pushing, let the existing deployment publish. No feature branches or
PR approvals. Stop and ask before destructive migrations, irreversible changes, paid services, or rebuilding APKs.
**Stable tags:** after the owner confirms a feature is stable, tag the verified commit `stable-<feature>-vN` (annotated)
and push it. Never move or overwrite a stable tag; never tag unverified work.

**Phase status** (one of): Not Started · In Progress · Implemented · Awaiting Device Verification · Verified Stable.
Only the owner moves a phase to Verified Stable. Current state and next action: `docs/DEVELOPMENT_STATUS.md`.

**Requirement status:** ✅ done · 🟡 partly done · ⬜ not started. Requirements stay listed until done, even when not being worked on.

**Execution order:** 1 → 2 → 2.5 → 2.6 → 3 → 4 → 5 → 6 → 7 → 8. The roadmap lead (Claude) works through it autonomously,
pushing tested increments to `master`, and stops for the owner at the end of each phase that needs Android testing or a
product decision.

| Phase | Status |
|---|---|
| 1 Unified Recipe System | Awaiting Device Verification |
| 2 Recipe Editor and Usability | Awaiting Device Verification |
| 2.5 Food Data Quality Audit and Restaurant Strategy | Implemented (awaiting owner review of findings and strategy) |
| 2.6 Ingredient Verification and Critical Data Corrections | Not Started |
| 3 Food Creation and Nutrition Facts OCR | Not Started |
| 4 Fill the Gaps Improvements | In Progress (earlier work shipped; remaining items not started) |
| 5 Ask Assistant Improvements | In Progress (earlier work shipped; remaining items not started) |
| 6 UX Improvements and Bug Fixes | In Progress (ongoing) |
| 7 Recipe Sharing and Favorites | Not Started (favorites already exist) |
| 8 Nutrition Intelligence | Not Started |
Each entry names where it lives so this file can be checked against the code.

---

## Phase 1 — Unified Recipe System · Critical · Awaiting Device Verification

One recipe system where any recipe can be logged, planned, or used as an ingredient in another recipe.
Design and rules: `docs/RECIPES.md`. Commits `17c48c7` (backend), `765105e` (app), plus the review/test follow-up.

| Requirement | Status | Where |
|---|---|---|
| Nested recipes at multiple levels | ✅ | `RecipeIngredient.RecipeId/Servings`, `RecipeNutritionCalculator` |
| Recipes contain individual foods and other recipes | ✅ | `RecipeIngredient.UseFood` / `UseRecipe` |
| Prevent circular recipe dependencies | ✅ | `RecipeGraph.PathTo`; error names the chain |
| Search custom recipes alongside regular foods | ✅ | `app/food/search.tsx` "Your recipes" |
| Clearly identify custom recipes in search results | ✅ | "Your recipe" badge (chef hat), `recipeRow` |
| Recipe logging and meal planning | ✅ | `app/recipe/amount.tsx`, `/diary/recipe`, `/plan/recipe` (Amount + Unit) |
| Servings with optional finished weight or volume | ✅ | `Recipe.CookedWeightGrams`, `FinishedVolumeMl` (additive migration) |
| Verified portion conversions | ✅ | `RecipeMeasures` (servings; g/oz and cup/tbsp/fl oz/ml only from entered weight/volume) |
| Deterministic nutrition from ingredients | ✅ | `RecipeNutritionCalculator` (unknown nutrients stay unknown) |
| Preserve ingredient source and quality metadata | ✅ | `IngredientDto.FoodSource/FoodQuality`; coverage + "minimum" warning for nested gaps |
| Recipe edits reflected in future uses of nested recipes | ✅ | `RecipeService.PropagateAsync` (innermost first) |
| Preserve snapshots in previously logged meals | ✅ | diary/plan `ItemSnapshot` unchanged by recipe edits (tested) |
| Reuse existing recipe, quantity, nutrition services | ✅ | same `Recipe`, `RecipeService`, `ItemAmounts`, `QuantityPicker` |
| Avoid historical recalculation / batch tracking | ✅ (by design) | not built |

Independent review (2026-11-23) found 10 issues, all fixed with regression tests: grocery list read a recipe planned by
weight as servings and didn't expand nested recipes; recipe entries converted from the recipe's current volume instead of
their own servings (now saved on the snapshot); heavy batches hit the 5 kg food limit; a re-pointed weighed line lost its
weight; removed finished weight kept an old conversion silently; the editor drifted the stored volume; ingredient amounts
were capped at 50 servings and didn't prefill; recipe search ran on every keystroke.

Known limits / follow-ups (carried into Phase 2 unless noted):
- Ingredient text is never auto-matched to your own recipes; you pick them (deliberate, avoids silent mismatches).
- A recipe used inside another can't be deleted until removed there (guard, not cascade).
- The recipe screen's own "Log or plan" box still takes servings only; weight/volume logging is via Add food → the recipe.
- Not yet verified on a physical Android phone (checklist: `docs/LOGGING.md` item 5).

## Phase 2 — Recipe Editor and Usability · High · Awaiting Device Verification

Commits `ed5dd9a` (API), `ddff772`, `94cf56b` (app), plus the review-fix commit. Rules: `docs/RECIPES.md` → Editing.

| Requirement | Status | Where |
|---|---|---|
| Search and add individual ingredients | ✅ | Ingredients → Add → search → amount → "Add to recipe" (`POST /recipes/{id}/ingredients`) |
| Search and add existing recipes as ingredients | ✅ | same search lists Your recipes (never the recipe itself; loops refused) |
| Easily edit ingredient quantities and measurements | ✅ | ingredient sheet: `QuantityPicker` in the food's own measures (up to 50 kg a line); nested recipes: Change amount |
| Adjust servings and scale recipes | ✅ | Change (servings) and Scale recipe ×½ ×1½ ×2 ×3 with a preview (`POST /recipes/{id}/scale`) |
| Nutrition per serving and for the entire recipe | ✅ | per serving / whole recipe / per 100 g (with finished weight) |
| Optionally enter finished weight or volume | ✅ | Edit recipe |
| Preserve existing website recipe importing | ✅ | Paprika and web-page import unchanged (tests) |
| Make imported ingredients easy to review and correct | ✅ | "N ingredients need a look" banner + Review stepping through only those lines |
| Intuitive mobile editing and navigation | 🟡 | done in the browser at 360–393 px; needs Android verification. The bulk text editor (Edit recipe) remains for pasting. |

Also: remove a line (two taps), log/plan from the recipe screen in its measures (cups/grams when known).
Independent review: 10 findings, all fixed with regression tests (scaling rewrote the wrong number in lines like "1 cup
(220 g) sugar" and could be undone by Refresh matches; a half-confirmed Remove survived closing the sheet; a slow Remove could
hit the next line; recipe lines were capped at 5 kg; review mode stuck after leaving through search; impossible weights were
accepted; doc and dead-code cleanups).
Limits: a line whose text doesn't start with a number keeps its original text when scaled (its scaled amount is kept and noted);
numbers inside parentheses are left alone (they're usually package sizes).

## Phase 2.5 — Food Data Quality Audit and Restaurant Strategy · High · Implemented (awaiting owner review)

Before OCR or nutrition scoring: audit the nutrition database and matching. Audit tooling must be read-only; no large
imports and no restaurant providers without owner approval.

- ✅ `docs/FOOD_DATA_QUALITY_AUDIT.md`: USDA Foundation, SR Legacy, FNDDS (Survey), branded lookup, Open Food Facts, custom
  foods, food search, barcode lookup, serving conversions, nutrient completeness, source provenance.
- 🟡 Measure actual database coverage where read-only access exists; otherwise ship reproducible read-only audit scripts and
  label unverified assumptions. (USDA coverage measured on a local copy of production's exact USDA files; production-only
  rows such as user, branded and OFF foods need `scripts/audit/food_data_audit.sql` run read-only against production.)
- ✅ Benchmark ingredient matching: dry vs cooked foods, coconut milk, ambiguous household measures, branded foods,
  AI-generated recipes.
- 🟡 Reproduce the Red Lentil and Sweet Potato Curry calculation (reported 364 kcal, 16 g protein, 55 g carbs, 10 g fat per
  serving) from the actual matches and gram conversions, without forcing the expected result. (A typical version reproduces it:
  388/16/58/11. The coconut milk can matches the beverage, and sweet potato a cooked dish with fat: ≈ 525 kcal, 26 g fat
  corrected. The owner's exact recipe text is still needed to confirm.)
- ✅ `docs/RESTAURANT_NUTRITION_STRATEGY.md`: official data for Chipotle, Chick-fil-A, McDonald's, Taco Bell, Panera,
  Starbucks: availability, licensing, freshness, costs, APIs, maintenance, commercial reuse (public ≠ redistributable).
- ✅ Recommend a low-cost strategy: USDA stays the core; restaurant nutrition added with attribution and a clear official vs
  estimate distinction.
- ✅ Only safe read-only audit tooling and tests are implemented in this phase (`scripts/audit/`, `MatchingBenchmark`).

## Phase 2.6 — Ingredient Verification and Critical Data Corrections · High · Not Started

- ⬜ Use the audit's findings to improve match transparency and fix demonstrated high-impact bugs (each with a regression test).
- ⬜ For AI-generated and imported recipes: a review showing original ingredient, matched food, source, gram weight,
  confidence, nutrition contribution and warnings; correction before saving where feasible.
- ⬜ Report match coverage, confidence and nutrient completeness separately; never imply 100% matching means accurate nutrition.
- ⬜ Stop for approval before any significant data migration or new external provider.

## Phase 3 — Food Creation and Nutrition Label OCR · High · Not Started

- ⬜ Photograph Nutrition Facts labels.
- ⬜ Extract calories, macros, micronutrients, and serving information.
- ⬜ Recognize serving sizes and measurement units.
- ⬜ Editable preview.
- ⬜ Flag uncertain or inconsistent values.
- ⬜ Require confirmation before saving.
- ✅ Save foods to the user's catalog (manual "From label" form exists).
- 🟡 Preserve nutrition provenance (manual foods are `User` source; OCR provenance to add).
- ⬜ Investigate on-device OCR to avoid recurring AI API costs (prefer free on-device OCR where practical).
- ✅ Maintain manual food creation as a fallback.

## Phase 4 — Fill the Gaps Improvements · High · In Progress (remaining items Not Started)

- ⬜ Consolidate repeated missing-nutrient warnings.
- ⬜ Concise nutrition summary.
- ⬜ Expandable details about incomplete nutrient information.
- 🟡 Distinguish missing data from confirmed deficiencies (`missingFrom`, minimum "≥" totals exist; UI to clarify).
- ⬜ Keep calorie and macro targets visible while browsing.
- 🟡 Recommend individual foods and custom recipes (both supported; nested recipes now included via cached nutrition).
- ✅ Breakfast, lunch, dinner, and snack filtering.
- ✅ Request different suggestions ("Show different ideas").
- ✅ Deterministic recommendation logic.
- ✅ Avoid repeated suggestions where alternatives exist.
- ✅ Never invent serving sizes or nutrition values.

## Phase 5 — Ask Assistant Improvements · High · In Progress (remaining items Not Started)

- ✅ Log foods through natural language.
- ⬜ Add custom recipes to diary entries.
- ⬜ Add foods and recipes to meal plans (foods: partly, via review "Plan"; recipes: no).
- ⬜ Edit existing diary entries.
- ⬜ Remove diary entries.
- 🟡 Interpret meal and date references (meal and simple dates yes).
- 🟡 Multiple actions in one request where practical (several foods in one meal yes; mixed actions no).
- ⬜ Preview ambiguous or destructive operations before execution (review card exists for logging).
- ✅ Reuse existing application services.
- ✅ Preserve authorization, validation, idempotency, and undo.
- ✅ Keep AI costs low; deterministic logic where practical (rule-based interpreter first).
- ✅ Partial selection and adding foods in Ask review (#61).

## Phase 6 — UX Improvements and Bug Fixes · Medium (quick fixes earlier) · In Progress

- ⬜ Smooth sign-out loading and navigation.
- ⬜ Avoid abrupt screen transitions.
- 🟡 Verify measurement-selector stability (fixed and browser-tested in #61; Android device check pending).
- 🟡 Verify Ask partial-selection behavior (browser-tested; Android device check pending).
- 🟡 Improve small-screen layouts (search field at 320–360 px fixed; continue).
- ⬜ Preserve scroll position where appropriate.
- ⬜ Keep important nutrition summaries visible.
- ⬜ Improve loading, empty, and error states.
- ✅ Maintain Android and web compatibility (CI web build + browser tests).
- ✅ Regression tests for fixed bugs (rule in `CLAUDE.md`; `mobile/e2e`).

## Phase 7 — Recipe Sharing and Favorites · Later · Not Started (favorites exist)

- ⬜ Share recipes with invited users.
- ✅ Favorite saved recipes.
- ⬜ Copy shared recipes into a personal collection.
- ⬜ Optional public recipe discovery (future).
- ⬜ Preserve ownership and attribution.
- ⬜ Define editing permissions.
- ⬜ Shared-recipe changes must not unexpectedly modify another user's data (note: nested recipes are owner-scoped today; sharing must copy, not link).
- ⬜ Moderation and commercialization only when needed.

## Phase 8 — Nutrition Intelligence · Medium–High (after recipe foundations and the Phase 2.5 data audit) · Not Started

### Food Quality Score
- ⬜ Transparent 0–100 food and recipe score.
- ⬜ Consider nutrient density, protein, fiber, sodium, added sugars, saturated fat.
- ⬜ Scientifically informed, documented methodology, not arbitrary health claims.
- ⬜ Fair handling of foods with different nutritional roles.
- ⬜ Support nested recipe calculations.
- ⬜ Category-level explanations and score drivers.
- ⬜ Data completeness shown separately from the score.
- ⬜ Unknown nutrient values never treated as zero.

### Daily Balance Score
- ⬜ 0–100 score relative to personalized daily targets.
- ⬜ Energy adequacy, protein, macros, fiber, micronutrients, nutrients to limit.
- ⬜ Appropriate target ranges and upper limits.
- ⬜ No reward for undereating or excessive intake.
- ⬜ Provisional progress during the day.
- ⬜ Explain which factors most affect the score.
- ⬜ Daily and weekly trends.
- ⬜ Incomplete records and missing values handled explicitly.

### Fill the Gaps integration
- ⬜ Estimate how suggestions affect Daily Balance.
- ⬜ Rank suggestions deterministically.
- ⬜ Respect calorie, macro, allergy and existing constraints.
- ⬜ Show why a recommendation helps.
- ⬜ Never claim missing data indicates a deficiency.

### Engineering requirements
- ⬜ No LLM in score calculations.
- ⬜ Centralized, versioned scoring algorithms; reproducible results; unit tests.
- ⬜ Preserve historical nutrition snapshots; keep scoring separate from raw nutrition facts.
- ⬜ Evaluate established nutrient-profiling methods (e.g. Nutri-Score, NRF9.3, Health Star Rating, HEI) before finalizing weights.
- ⬜ Test edge cases: oils, fortified foods, desserts, high-protein products, incomplete labels, mixed recipes.
- ⬜ Never present scores as diagnoses or clinically validated assessments without supporting validation.

---

## Merged from Copilot PRs

Reviewed at the end of Phases 2 and 2.5 (2026-11-23), tested locally with Postgres, then merged into master:

| PR | Feature | Roadmap fit | Notes |
|---|---|---|---|
| #65 | Clear a meal (diary): confirm, Undo, planned items reopened | Phase 6 (UX) | atomic; refuses partial deletes if the meal changed; own isolation + Postgres tests |
| #67 | Remove/restore grocery items (also plan-generated) | Phase 6 (UX) | additive migration `GroceryExclusions` (new owner-scoped table); cross-user and browser tests added at merge |
| #66 | Move several diary entries to another meal | Phase 6 (UX) | merged later (`bff4a51`) once Copilot finished: 5 conflicts with #65 resolved keeping both; Clear hidden while selecting; a fragile test assertion fixed |

## Development principles

1. Prefer simple solutions over unnecessary architecture.
2. Extend existing components and services rather than duplicating functionality.
3. Keep nutrition calculations deterministic and traceable.
4. Never interpret unknown nutrient values as zero.
5. Preserve historical diary and plan nutrition snapshots.
6. Keep the existing dark visual design.
7. Prioritize Android usability while maintaining the web application.
8. Run relevant automated tests before pushing changes.
9. Implement features in manageable, independently testable increments.
10. Document important architectural decisions.
11. Avoid paid APIs unless explicitly approved.
12. Do not perform destructive production data changes without approval.

## Stable tags

| Tag | Commit | Confirmed by owner |
|---|---|---|
| _(none yet)_ | | |
