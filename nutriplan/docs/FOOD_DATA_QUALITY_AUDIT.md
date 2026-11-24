# Food Data Quality Audit (Phase 2.5)

Date: 2026-11-23. Scope: the nutrition database and ingredient matching, ahead of OCR (Phase 3) and scoring (Phase 8).

## How this was measured (and what wasn't)

- **Measured:** a local, disposable copy loaded with the **same USDA files production downloads** (Foundation 2026-04-30,
  SR Legacy 2018-04, FNDDS/Survey 2024-10-31) through the app's own importer (`import-usda`) and portion enricher (49 of
  115 linked Foundation foods enriched, the same count as the production run on 2026-11-22). The numbers below come from that copy.
- **Not measured: production-only data.** That means user-created foods, saved USDA Branded products, Open Food Facts products and real
  recipes. This environment can't reach the production database (and shouldn't write to it). Run the same read-only script
  against production to get those rows: `scripts/audit/README.md`.
- **Tooling** (read-only, committed):
  - `scripts/audit/food_data_audit.sql`: runs inside a `READ ONLY` transaction that is rolled back.
  - `MatchingBenchmark` test: runs only when `NUTRIPLAN_AUDIT_DB` is set. Its own transaction is rolled back, and nothing is saved.
  - Inputs: `scripts/audit/matching_benchmark.txt`.
  - Outputs: `docs/audit/food_data_audit_2026-11-23.txt` and `docs/audit/matching_benchmark_2026-11-23.md`.

> Safety note found during the audit: a git-ignored `nutriplan/.env.local` in the development container holds the
> production `DATABASE_URL`, and the app prefers it over `ConnectionStrings`. A local `dotnet run` therefore targets
> production unless `DATABASE_URL`/`DATABASE_URL_UNPOOLED` are set explicitly. (The sandbox's network blocked the attempt;
> nothing reached production.) Recommendation: remove production URLs from developer `.env` files, or use a read-only role.

## 1. Coverage by source

| Source | Foods | Quality | Notes |
|---|---|---|---|
| USDA Foundation | 378 (of 469 read; 91 skipped by the importer) | Verified | Lab-analysed, few portions |
| USDA SR Legacy | 7,793 | Verified | Frozen since 2018; best household measures |
| USDA FNDDS (Survey) | 5,431 | Verified | Foods "as eaten", often prepared/cooked, complete 65-nutrient profiles |
| USDA Branded | fetched live, saved when opened | Unverified by default | Production only; not measured here |
| Open Food Facts | barcode fallback, saved when scanned | Unverified | Production only |
| User foods | per user | User | Production only |

## 2. Nutrient completeness (% of foods reporting the nutrient; absent = unknown)

| Source | kcal | Protein | Carbs | Fat | Fiber | Sugars | Added sugars | Sat fat | Sodium | Vit D | Vit C | B12 | Folate |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Foundation | 100 | 99.7 | 99.7 | 99.7 | 48.9 | 41.5 | **0** | 33.1 | 98.1 | 16.4 | 32.8 | 22.5 | **0** |
| SR Legacy | 100 | 100 | 100 | 100 | 92.8 | 77.1 | **0** | 95.6 | 98.9 | 66.5 | 94.1 | 91.3 | 83.2 |
| FNDDS | 100 | 100 | 100 | 100 | 100 | 100 | **0** | 100 | 100 | 100 | 100 | 100 | 100 |

Findings:
- **Added sugars are never reported by the USDA generic datasets** we load (0% everywhere). Only Branded labels carry them.
  Any added-sugar total or score is therefore a minimum unless every food is a labelled product. This matters for Phase 8.
- **Foundation foods report folate 0% of the time** although Foundation data include folate. It is likely published under
  another nutrient id (e.g. total folate, not folate DFE 1190). Verify the importer's nutrient-id mapping (Phase 2.6).
- Foundation foods are sparse (median 18 nutrients, against 33 in SR Legacy and FNDDS).
- Energy: every food reports kcal. 203 SR/FNDDS foods differ from 4/4/9 by more than 25% (mostly alcohol, polyols and
  fibre-rich items; legitimate in most cases). Three foods report 0 kcal with more than 5 g of macros (to inspect).

## 3. Household measures (portions)

| Source | With ≥1 portion | Borrowed (with `origin`) |
|---|---|---|
| Foundation | 42.3% | 13.0% |
| SR Legacy | 96.6% | 0 |
| FNDDS | 99.0% | 0 |

Many Foundation foods still can't be measured in cups or pieces. The matcher compensates by preferring a same-food SR Legacy entry.

## 4. Ingredient matching benchmark (52 representative lines)

Full table: `docs/audit/matching_benchmark_2026-11-23.md`. The app's matcher, unchanged, against real USDA data:

**Works well:**
- Dry staples, with the right raw/dry entries and USDA cup weights: red lentils, quinoa, pasta, rolled oats.
- Cooked staples: cooked lentils, cooked brown rice.
- Spices and aromatics: garlic cloves, ginger, curry powder, cumin, turmeric, olive oil.
- Proteins: chicken breast, salmon, 80/20 beef, eggs, tofu.
- "salt to taste" is left out on purpose.

**High-impact errors (wrong food, confidently):**

| Line | Matched | Why it's wrong | Effect |
|---|---|---|---|
| 1 can (13.5 oz) coconut milk | FNDDS "Coconut milk" (31 kcal/100 g) | that's the **beverage**; canned is SR "Nuts, coconut milk, canned" (197 kcal, 21 g fat/100 g) | −635 kcal, −74 g fat per can; confidence 1.00 |
| 400 ml coconut milk | same | same | −660 kcal |
| 2 medium sweet potatoes | FNDDS "Sweet potato, NFS" (115 kcal, 4.5 g fat/100 g) | a **cooked dish with fat added**; raw is 86 kcal, 0.05 g fat | +87 kcal, +13 g fat for 300 g |
| 1 cup unsweetened coconut milk beverage | "Beverages, rice milk, unsweetened" | wrong food | flagged "check" (0.43) |
| 1 cup uncooked white rice | "Rice, white, **glutinous**, uncooked" | wrong variety (close nutritionally) | small |

**Correctly flagged for review (not guessed):** "1 bunch cilantro", "a handful of spinach" and "1 can light coconut milk"
have no measure, so no grams were invented. Vegetable broth is marked as a chicken-broth stand-in. "1 Chobani greek yogurt"
has no portion, so the user enters grams. Branded wording ("Dave's Killer Bread") falls back to a generic food with
"check".

**Patterns behind the errors:**
1. **FNDDS short names win.** FNDDS "Coconut milk" and "Sweet potato, NFS" have the shortest, closest names, so they outrank
   the SR entries that describe the ingredient as bought. FNDDS describes foods *as eaten* (often cooked or with fat added), which
   suits logging a meal but is wrong for recipe ingredients.
2. **Confidence measures name similarity, not food identity.** The coconut milk match has confidence 1.00. 100% matched
   and 100% confident can still be 40% wrong on calories.
3. Recipe context ("can", "full-fat", "light", "beverage") isn't used to choose between variants.

## 5. Red Lentil and Sweet Potato Curry: reported 364 kcal · 16 g P · 55 g C · 10 g F per serving

The owner's exact recipe text isn't available in this environment (it lives in production). A typical AI-generated
version (15 lines, 4 servings; in `matching_benchmark.txt`) gives, with today's matcher and real USDA data:

**388 kcal · 16.4 g P · 58.2 g C · 11.3 g F per serving, 100% "coverage"**

That's within about 7% of the reported numbers, so the reported result is very likely this same calculation. It is
probably **too low**:

| Correction (computed by hand from the USDA per-100 g values above, not by the app) | kcal/serving | Fat/serving |
|---|---|---|
| As matched today | 388 | 11.3 |
| Coconut milk: canned (SR 197 kcal, 21.3 g fat/100 g) instead of the beverage | +159 | +18.4 |
| Sweet potato: raw (86 kcal, 0.05 g fat/100 g) instead of FNDDS "NFS" with fat | −22 | −3.4 |
| **Corrected estimate** | **≈ 525** | **≈ 26** |

Protein ≈ 18 g and carbs ≈ 60 g per serving after the same corrections. If the original used **light** coconut milk
(about 70–80 kcal/100 g), the result sits between these numbers. To confirm, share the original recipe or let me read it
read-only from production. This wasn't forced to a target; it is what the data and matcher produce.

## 6. Recommendations (inputs to Phase 2.6; each with a regression test)

1. **Recipe ingredients: prefer "as purchased" entries over FNDDS "as eaten" dishes** when an SR/Foundation entry names the
   same food (or penalise "NFS" and prepared FNDDS forms in recipe matching only, keeping FNDDS for logging meals).
2. **Coconut milk:** use "can", "canned", "full-fat", "light" and "beverage" to choose the variant; never match a beverage to
   a canned line.
3. **Separate three numbers in the UI:** match coverage (lines matched), match confidence (how sure the food is right),
   and nutrient completeness (how many nutrients are known). Today only coverage is prominent.
4. **Ingredient review for imported/AI recipes:** show the original line, matched food, source, grams, confidence, kcal
   contribution and warnings before saving (Phase 2.6; the Phase 2 Review flow is the start).
5. Verify the Foundation **folate** mapping and the **91 skipped Foundation foods** in the importer.
6. Treat **added sugars** as unknown in scoring unless labelled.
7. Remove production database URLs from developer `.env` files (see the safety note).

## 7. Phase 2.6 follow-up (2026-11-24, branch `claude/nutrition-meal-planning-app-9e9qj9`)

- **Recipe matching** (recommendations 1–2): fixed, with regression tests (`RecipeMatchingTests`). Benchmark re-run:
  `docs/audit/matching_benchmark_2026-11-24.md`. A can of coconut milk now matches SR canned coconut milk (754 kcal per can,
  was 119), "light coconut milk" is left unmatched with the reason, the unsweetened beverage is a flagged stand-in, sweet
  potatoes are raw, and "1 can diced tomatoes" is canned tomatoes. The curry above comes out at **504 kcal · 18 g P · 57 g C ·
  26 g F** per serving (was 388; hand estimate ≈ 525). Known side effects: "Fairlife 2% milk" drops to "check" (0.46), and a
  brand-only bread line still matches a generic bread (flagged "check" before and after).
- **Folate** (recommendation 5): Foundation publishes total folate (1177), never DFE (1190). The importer now uses total folate as DFE
  when no folic acid can be present (not enriched/fortified), and computes DFE from food folate + 1.7 × folic acid
  when both are published. On a fresh import of the same file, 142 of 378 Foundation foods get folate (was 0). **Existing
  production rows are unchanged:** the importer skips foods already imported; a backfill would be a data change and needs approval.
- **The 91 skipped Foundation foods:** correctly skipped. None report energy or a full macro profile: 34 are "0% moisture"
  (dry-basis lab samples, not food as eaten) and 57 are partial analyses (oils, butter, breads, lunchmeats, some produce).
  SR Legacy covers the same foods. Inventing their calories would break the nutrition rules.

No data was changed and no provider was added. Changes to matching and data are proposed for Phase 2.6 and need no
migration. Re-importing or re-matching existing recipes would be a data change and needs approval.
