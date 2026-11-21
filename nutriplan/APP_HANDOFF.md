# Intake Grid (formerly NutriPlan) — Application Handoff (for UI/UX & product collaborators)

> **Purpose.** A factual description of the NutriPlan codebase as it exists on branch `claude/nutrition-meal-planning-app-9e9qj9`
> (repo folder `nutriplan/`), written for another AI or designer who will help with UI/UX and product work.
> Everything below was checked against the code. Where something exists in the backend but has no UI, or exists in the UI but
> has never been verified on a real device, that is stated explicitly.
>
> **No secrets are included.** Keys and connection strings live in environment variables on the hosting provider and in local,
> git-ignored files.

**Status legend** used throughout:

| Mark | Meaning |
|---|---|
| ✅ | Implemented and exercised (automated tests and/or end-to-end checks against the real API) |
| ☑️ | Implemented, but never verified on a real Android device (camera, microphone, native build behavior) |
| ⚠️ | Partially implemented: backend exists without UI, UI exists with gaps, or known defects |
| 🗓 | Planned / proposed, not implemented |
| ❌ | Not implemented and not planned yet |

---

## 0. Summary

NutriPlan is a **single-user** nutrition tracker in the spirit of Cronometer, plus meal planning:

- Log food by **search, barcode, voice, or natural-language chat**; numbers always come from a food database (USDA FoodData Central, user-entered labels, or Open Food Facts), never from the AI.
- **Recipes**: import from Paprika exports or recipe web pages; nutrition computed per ingredient.
- **Weekly plan**: planned vs. eaten, weekly calorie budget that adapts after over/under-eating, batch cooking (leftovers).
- **Fill Gaps**: an optimizer suggests foods/recipes to close remaining calorie, macro and micronutrient gaps.
- **Pantry** (what can I make), **grocery list** (from the plan, minus pantry), **weekly nutrient heatmap**.

The owner uses it daily through the **web build** (served by the API on Render) and an **Android APK** built by GitHub Actions.
The owner explicitly chose **not** to include adaptive calorie / TDEE estimation.

A UI redesign is in progress: **only the Today screen** has been redesigned to "UI/UX Design Specification v1" (see §6). All other
screens still use the original styling and are awaiting review before redesign.

---

## 1. Architecture

### 1.1 Overview

```
 Android APK (Expo / React Native)  ─┐
                                     ├─ HTTPS + X-Api-Key ─▶  ASP.NET Core API (.NET 10)  ──▶  PostgreSQL
 Web app (same code, exported) ──────┘                        │  also serves the web build       (Neon in production,
                                                              │                                  local Postgres in dev)
                                                              ├─▶ Open Food Facts (barcode fallback, HTTPS)
                                                              └─▶ Anthropic Claude API (optional; chat + recipe ideas)
```

| Layer | Technology | Notes |
|---|---|---|
| Mobile/web client | Expo SDK 58, React Native 0.88, React 19.3, TypeScript (strict) | Android-first; the same code exports to web (react-native-web). iOS untested. |
| Backend | ASP.NET Core 10 minimal APIs, clean layering | `Domain` → `Application` → `Infrastructure` → `Api` |
| Database | PostgreSQL 16 via EF Core 10 + Npgsql, snake_case naming | jsonb columns for nested value objects; `pg_trgm` for search |
| Hosting (prod) | Render (Docker web service) + Neon (managed Postgres) | One container serves the API **and** the exported web app |
| CI/CD | GitHub Actions: `nutriplan-ci.yml` (tests, type-check, lint, web export, optional Render deploy hook) and `nutriplan-android.yml` (builds APK, publishes Release `android-latest`) | |
| Food data | USDA FoodData Central CSV (Foundation, SR Legacy, Survey/FNDDS), ~13,600 foods; Open Food Facts API for barcodes | Branded USDA (~450k) supported by importer but **not** loaded by default |

### 1.2 Repository map (`nutriplan/`)

```
backend/
  src/NutriPlan.Domain/          Pure rules: nutrients, foods, units, parsing, recipes, diary, planning, gap filler (no packages)
  src/NutriPlan.Application/     Use-case services + ports (interfaces), DTOs, ranking, importers (Paprika, JSON-LD), rule-based NLP
  src/NutriPlan.Infrastructure/  EF Core DbContext + repositories, migrations, USDA importer/seeder, Open Food Facts, Claude, web fetcher, .env loader
  src/NutriPlan.Api/             Program.cs, endpoint mapping, API-key middleware, static web hosting
  tests/                         xUnit: Domain (37), Application (30), Infrastructure (25 incl. Postgres integration) = 92
mobile/
  src/app/                       Expo Router screens (file-based routes)
  src/features/today/            Today screen building blocks (redesigned)
  src/components/ds/             New design-system components (redesigned screens only)
  src/components/*.tsx           Legacy components (ui.tsx, charts.tsx, ItemRow, AmountPicker, VoiceButton)
  src/theme/                     New design tokens + ThemeProvider
  src/lib/theme.ts               Legacy theme (still used by non-redesigned screens)
  src/api/                       fetch client, TanStack Query hooks, DTO types
docs/                            ARCHITECTURE.md, DEPLOY.md, today-redesign.png
scripts/download-usda.sh         Download + import USDA datasets
Dockerfile, docker-compose.yml   Production image; local Postgres
neon.ts, package.json            Neon CLI project config (created by `neon init`; not used at runtime)
```

### 1.3 Backend layering

- **Domain**: `NutrientProfile` (immutable map of nutrient id → amount), `Food`, `FoodPortion`, `Units`/`QuantityResolver`, `QuantityTextParser`,
  `Recipe`/`RecipeIngredient`/`RecipeNutritionCalculator`, `DiaryEntry`/`ItemSnapshot`, `PlanEntry`, `NutritionTargets`,
  `WeeklyBudgetCalculator`, `GapFiller`, `PantryItem`, `EnergyConsistency`.
- **Application**: `FoodService`, `FoodRanker`, `DiaryService`, `PlanService`, `GapFillService`, `GroceryService` (+ `Aisles`), `TargetsService`,
  `RecipeService` (+ `IngredientQuery`, `PaprikaImporter`, `JsonLdRecipeExtractor`, `ServingsParser`), `PantryService`, `InsightsService`,
  `AssistantService` + `RuleBasedInterpreter`. Ports: repositories, `IBarcodeProvider`, `IWebPageFetcher`, `ILanguageInterpreter`, `IRecipeIdeaGenerator`, `IClock`.
- **Infrastructure**: `NutriPlanDbContext` (also the unit of work), repositories, `UsdaImporter`, `UsdaSeeder` (hosted service, imports on
  first start when the foods table is empty), `OpenFoodFactsProvider`, `HttpWebPageFetcher` (blocks private/loopback IPs),
  `ClaudeJsonClient`/`ClaudeInterpreter`/`ClaudeRecipeIdeaGenerator`, `ConnectionStrings` (converts `postgres://` URLs),
  `DotEnv` (loads `.env.local`/`.env` for local runs), `SystemClock` (configurable time zone).
- **Api**: applies EF migrations on startup; `X-Api-Key` middleware on `/api/*` when a key is configured; CORS allows any origin;
  serves `wwwroot` (exported web app) with SPA fallback; `dotnet run -- import-usda <folders>` CLI mode.

### 1.4 Persistence model (tables)

| Table | Key columns | jsonb columns | Notes |
|---|---|---|---|
| `foods` | id, name, brand, source, source_id, barcode, category, quality, quality_note, is_archived | `nutrients_per100g`, `portions` | Trigram GIN index on `name`; index on barcode, (source, source_id) |
| `recipes` | id, name, servings, origin, external_id, directions, photo (bytea), is_favorite, nutrition_coverage, … | `ingredients`, `categories`, `nutrition_per_serving` | Nutrition per serving is **cached** (recomputed when ingredients change) |
| `diary_entries` | id, date, meal, plan_entry_id, note, logged_at | `item` (ItemSnapshot) | Nutrition is **snapshotted** at log time |
| `plan_entries` | id, date, meal, status (Planned/Eaten/Skipped), batch_id | `item` (ItemSnapshot) | |
| `pantry_items` | id, name, food_id, grams, expires_on, is_staple | | |
| `targets` | id (singleton = 1), calories, protein/carb/fat grams, budget_mode, week_starts_on, max_daily_adjustment | `nutrient_overrides`, `focus_nutrients` | **Single-user**: one row |

Nutrient ids are **USDA FoodData Central nutrient ids** throughout (1008 energy, 1003 protein, 1005 carbs, 1004 fat, 1079 fiber, …);
~35 nutrients are tracked (`NutrientCatalog`).

### 1.5 Client navigation & state

- **Navigation**: Expo Router. Root `Stack` (`src/app/_layout.tsx`) containing a `(tabs)` group with five tabs:
  **Today** (`index`), **Week** (`plan`), **Ask** (`assistant`), **Recipes**, **More**. Other screens are stack routes: `food/search` (modal),
  `food/[id]`, `scan` (full-screen modal), `quick-add` (modal), `custom-food`, `recipe/[id]`, `gaps`, `grocery`, `pantry`, `insights`, `targets`, `settings`.
  Route params carry context (`date`, `meal`, `mode=log|plan|ingredient`, `recipeId`, `position`, `planDate`, `listen`).
- **Server state**: TanStack Query. All calls live in `src/api/hooks.ts`; mutations that change eaten/planned food invalidate
  `day`, `week`, `quickLog`, `gaps`, `heatmap`, `grocery`, `rebalance`. No offline cache or persistence.
- **Local state**: React `useState` per screen. **Settings** (server URL + API key) in AsyncStorage (`localStorage` on web).
  Default server URL: `EXPO_PUBLIC_API_URL` if baked at build time → on web, the page's own origin → otherwise `http://10.0.2.2:5154` (Android emulator).
- **App-wide providers** (root layout): `SafeAreaProvider` → `QueryClientProvider` → `ThemeProvider` → `SnackbarProvider` (Undo bar).

### 1.6 Major dependencies

**Mobile**: expo 58, react-native 0.88.1, react 19.3.0, expo-router, @tanstack/react-query 5, @react-native-async-storage/async-storage,
expo-camera (barcodes), expo-speech-recognition (voice), expo-document-picker (Paprika files), expo-haptics, react-native-svg,
**lucide-react-native** (icons; imported per-icon via `src/components/ds/icons.ts`, enforced by an ESLint rule — importing the package root
adds ~2.3 MB), react-native-web/react-dom (web export), expo-dev-client.

**Backend**: Npgsql.EntityFrameworkCore.PostgreSQL 10, EFCore.NamingConventions, Anthropic (official C# SDK) 13.x, CsvHelper 33,
Microsoft.AspNetCore.OpenApi, Microsoft.Extensions.* (Http, Hosting, Options).

---

## 2. Existing functionality

### 2.1 Screens

| Screen (route) | Purpose | Status | Notes |
|---|---|---|---|
| **Today** (`(tabs)/index`) | Calorie/macro summary, quick logging, meals, nutrients | ✅ **Redesigned** | See §3, §6. Verified with a 21-check browser test (not committed to repo). |
| **Week** (`(tabs)/plan`) | 7-day plan vs. eaten, budget, rebalance banner, links to grocery/heatmap | ✅ legacy UI | Entry actions: I ate this, ×1.25, Skip, Remove. No move/swap UI. |
| **Ask** (`(tabs)/assistant`) | Chat/voice: food matches, recipe search/ideas, what-can-I-make, gaps | ✅ legacy UI / ⚠️ | Mic auto-listen from Today added. `PlanMeal` intent defect (§7.4). |
| **Recipes** (`(tabs)/recipes`) | Recipe list/search, Paprika + URL import | ✅ legacy UI | Photos served from API. |
| **More** (`(tabs)/more`) | Links: Grocery, Pantry, Heatmap, Fill gaps, Targets, Settings; server status line | ✅ legacy UI | |
| Food search (`food/search`) | Type/speak a query, ranked results, scan, add from label | ✅ legacy UI | Shared by log, plan and recipe-ingredient flows (`mode`). |
| Food amount (`food/[id]`) | Pick portion × amount or grams/oz; meal; add to diary/plan/ingredient | ✅ legacy UI | Shows nutrient list per 100 g. |
| Scan (`scan`) | Camera barcode scanner (EAN-13/8, UPC-A/E) | ☑️ | Never tested on a device in development; web scan untested. |
| Quick calories (`quick-add`) | Log calories (+ optional macros) without a food | ✅ | No micronutrients by design. |
| Custom food (`custom-food`) | Enter a Nutrition Facts label (per serving) | ✅ | Converted to per-100 g; checked against 4/4/9. |
| Recipe detail (`recipe/[id]`) | Nutrition per serving, ingredient matches, plan/log/batch, favorite, delete | ✅ legacy UI / ⚠️ | No editor for name/servings/ingredients (§7.1). |
| Fill gaps (`gaps`) | Remaining targets + up to 3 suggestion combos; "Add to plan" | ✅ legacy UI | Adds all items to the current time-of-day meal. |
| Grocery (`grocery`) | Aisle-grouped list from plan; pantry subtracted; share | ✅ legacy UI / ⚠️ | Check marks are not saved. |
| Pantry (`pantry`) | Add (name + optional use-within), remove; "You can make" | ✅ legacy UI / ⚠️ | No quantity, staple flag or edit in UI. |
| Insights (`insights`) | Weekly nutrient heatmap + highlights | ✅ legacy UI | |
| Targets (`targets`) | Calories, macros, daily vs weekly budget, micronutrient targets | ✅ legacy UI / ⚠️ | Week start day, max daily adjustment, focus nutrients not editable. |
| Settings (`settings`) | Server URL + API key, "Save & test" | ✅ | |

### 2.2 Feature matrix (backend vs. UI)

| Capability | Backend | UI | Status |
|---|---|---|---|
| Food search with ranking | `GET /foods/search` | Food search | ✅ |
| Text → food matches with grams | `GET /foods/match`, `POST /assistant` | Ask (via `/assistant`) | ✅ (`/foods/match` itself unused by UI) |
| Barcode lookup (local → OFF) | `GET /foods/barcode/{code}` | Scan | ☑️ |
| Custom food from label | `POST /foods` | Custom food | ✅ |
| Mark food verified | `POST /foods/{id}/verify` | — | ⚠️ backend only |
| Unit → grams preview | `GET /foods/{id}/quantity` | — (client computes from portions) | ⚠️ backend only |
| Log food / recipe / quick | `POST /diary/food|recipe|quick` | Today, Ask, Food amount, Recipe, Quick add | ✅ |
| Edit entry (scale, meal, date, note) | `PATCH /diary/{id}` | Today entry sheet (amount + meal) | ✅ (date/note not exposed) |
| Delete entry | `DELETE /diary/{id}` | Today (with 5 s Undo) | ✅ |
| Quick log (frequent items) | `GET /diary/quick-log` | Today "Recent" chips | ✅ |
| Copy meal/day | `POST /diary/copy` | — | ⚠️ backend only |
| Re-log a past entry | `POST /diary/{id}/relog` | — | ⚠️ backend only |
| Week view + budget | `GET /plan/week` | Week, Today (planned items) | ✅ |
| Plan food / recipe | `POST /plan/food|recipe` | Food amount (mode=plan), Recipe, Gaps | ✅ |
| Batch (leftovers) | `POST /plan/batch` | Recipe "Cook once, plan leftovers" | ✅ |
| Mark planned eaten | `POST /plan/{id}/eaten` | Week, Today "Log" | ✅ |
| Skip / remove plan entry | `POST /plan/{id}/skip`, `DELETE` | Week | ✅ |
| Move / swap / rescale plan entry | `POST /plan/{id}/move|swap-recipe|swap-food|rescale` | — | ⚠️ backend only |
| Rebalance proposals | `GET/POST /plan/rebalance` | Week banner | ✅ |
| Fill gaps | `GET /plan/gaps` | Gaps, Ask, Today button | ✅ |
| Grocery list | `GET /plan/grocery` | Grocery | ✅ |
| Targets | `GET/PUT /targets` | Targets | ✅ (subset of fields) |
| Recipes CRUD | `GET/POST/PUT/DELETE /recipes` | List, detail, delete, create-from-idea | ⚠️ no edit (PUT unused) |
| Fix ingredient match | `PUT /recipes/{id}/ingredients/{pos}` | Recipe → choose food / exclude | ✅ |
| Re-match ingredients | `POST /recipes/{id}/rematch` | — | ⚠️ backend only |
| Paprika import | `POST /recipes/import/paprika` | Recipes | ✅ (synthetic export tested; no real user export tested) |
| URL import (schema.org) | `POST /recipes/import/url` | Recipes | ✅ parser unit-tested; live fetch not tested in dev |
| Pantry CRUD + what-can-I-make | `/pantry`, `/pantry/what-can-i-make` | Pantry (add/remove only) | ⚠️ edit unused |
| Heatmap | `GET /insights/heatmap` | Insights | ✅ |
| Assistant | `POST /assistant` | Ask | ✅ / ⚠️ (§7.4) |
| Status | `GET /status`, `GET /health` | More, Settings | ✅ |

### 2.3 How features interact

- **Diary ↔ Plan**: plan entries are separate rows. "Log" / "I ate this" calls `POST /plan/{id}/eaten`, which creates a diary entry
  (copying the plan item's snapshot, optionally scaled) with `plan_entry_id` set and marks the plan entry `Eaten`. Totals always come from the
  diary only; planned food never counts toward "eaten".
- **Plan ↔ Budget**: the week view sums diary calories per day + remaining planned calories; `WeeklyBudgetCalculator` adjusts remaining days.
- **Plan ↔ Grocery ↔ Pantry**: grocery list = ingredients of planned (not eaten/skipped) recipes scaled by planned servings + planned foods,
  merged by food, minus pantry grams (or marked "in pantry" when the pantry item has no quantity).
- **Recipes ↔ Foods**: ingredient lines are matched to foods and grams; recipe nutrition per serving is cached on the recipe.
- **Diary history ↔ Gaps/Quick log/Search**: frequently logged foods boost search ranking, feed the Recent chips, and seed gap suggestions.
- **Assistant** is an orchestrator: it interprets text (Claude or rules) and then calls the same food/recipe/pantry/gap services.

---

## 3. Food logging

### 3.1 Search & selection

1. User types (or dictates via the mic button in the search field) on **Food search**. Query must be ≥ 2 characters.
2. `GET /foods/search?q=…` → repository finds candidates whose **name/brand contains every query token** (trigram-indexed `ILIKE`;
   names starting with the first token first), with an "any token" fallback when few results; up to `limit × 12` (min 300) rows.
3. `FoodRanker` scores candidates (pure, unit-tested):
   - coverage of query tokens (+ bonus when all present), position in the USDA "head" segment (skipping category prefixes like
     "Nuts," "Fish," "Beverages,"), penalties for extra words, derived products ("almond **butter**"), processed forms (breaded, canned, dried…);
   - raw preferred unless the query names a cooking method; plain descriptors ("whole", "plain", "NFS") boosted;
   - source trust (User 10, Recipe 8, Foundation 7, SR Legacy 6, Survey 6, Branded 1, OFF 0), quality (Verified +3, Flagged −12);
   - **personal history** (log count, log-scaled, up to +20); trigram similarity as a tie-breaker.
   - Same-name duplicates collapse to one result, preferring the one that has household measures.
4. Results show name, brand, quality badge, per-100 g macros. Tapping opens **Food amount** with portion chips (USDA measures + g + oz),
   live nutrition preview, meal chips; "Add" logs (or plans, or sets a recipe ingredient, depending on `mode`).

### 3.2 Barcode scanning ☑️

- `expo-camera` `CameraView` with `ean13, ean8, upc_a, upc_e`. On scan: `GET /foods/barcode/{code}`.
- Backend normalizes (UPC-A 12 → EAN-13 with leading 0; GTIN-14 leading 0 stripped), checks local foods (User > USDA Branded > others),
  then **Open Food Facts** (`/api/v2/product/{code}.json`; per-100 g values; minerals/vitamins converted from grams; kJ→kcal fallback;
  salt→sodium fallback). OFF hits are saved locally (source `OpenFoodFacts`, quality `Unverified`, flagged if inconsistent).
- Unknown barcode → **Custom food** screen pre-filled with the barcode so the label is entered once.
- Verified only via backend tests and live OFF calls in development; **camera scanning has not been tested on a physical device**.

### 3.3 Voice & natural language

- **Voice**: `expo-speech-recognition` (device recognizer, on-device where supported), interim + final results; the final transcript is
  sent to the assistant. Today's mic button opens Ask with a `listen` token that **auto-starts listening**. Denied permission and engine
  errors (no microphone, offline, unsupported) show an inline notice on Ask, and typing stays available. On web, permission is reported by the browser engine.
  ☑️ Not tested with a real microphone in development (web tests used a simulated engine).
- **Interpretation** (`AssistantService`):
  - If a Claude API key is configured: `ClaudeInterpreter` uses **structured outputs** (strict JSON schema) to return
    `intent` (log_food, find_food, find_recipes, what_can_i_make, fill_gaps, plan_meal, unknown), items
    (`food_query`, amount, unit, preparation, brand, `cooked_state` raw/cooked), meal, date, recipe query/count, optional reply.
    The system prompt forbids nutrition numbers. Default model is configurable (`Claude:InterpreterModel`, default `claude-opus-5-5`;
    `claude-haiku-5-5` suggested for cost). Server-side refusal fallback beta is enabled for supported models.
  - Otherwise, or on any Claude error: `RuleBasedInterpreter` (keywords + `QuantityTextParser`; splits "2 eggs and toast" into items;
    detects meal words and yesterday/today/tomorrow).
  - The `FoodService.Synonyms` table maps everyday words to USDA phrasing (toast → "bread toasted", coffee → "coffee brewed", oj, pb, egg/eggs, tea, water).
- **Results UI (Ask)**: each item shows up to 4 matches with grams and calories; user picks a match, then **Add to {meal}** (logs) or **Adjust**
  (opens Food amount). Nothing is logged without a tap. Ask's responses also render saved recipes, AI recipe ideas (with computed
  nutrition and "Save recipe"), cookable recipes, and a link to Fill gaps.

### 3.4 USDA data, matching & nutrition math

- **Datasets imported**: Foundation (lab-analyzed), SR Legacy (broad, has household measures), Survey/FNDDS ("as eaten", everyday names).
  Branded is supported but not loaded by default. Foods without any energy value are skipped (e.g. 91 Foundation foods).
- Importer specifics: energy = 1008, else Atwater Specific (2048), else Atwater General (2047); sugars 2000 or 1063; FNDDS legacy nutrient
  numbers translated via `nutrient.csv`; portions built from unit + description + modifier; FNDDS "1 cup" descriptions split into amount + unit;
  misleading portions dropped ("Guideline amount…", "… dry, yields"); **negative values clamped to 0** (carbs "by difference" can be slightly negative).
- **Data quality**: `EnergyConsistency` compares listed kcal with 4/4/9 (and a fiber-adjusted variant at 2 kcal/g fiber):
  ≥ 15 % difference = Suspicious (→ Unverified), ≥ 30 % = Inconsistent (→ Flagged). **USDA lab data is exempt** (it uses food-specific factors).
- **Nutrition of a logged item** = `per100g × grams / 100`, all tracked nutrients, snapshotted (rounded to 3 decimals) in the entry.

### 3.5 Portions & unit conversion (`QuantityResolver`)

- **Mass** units (g, kg, mg, oz, lb) convert exactly.
- **Volume** (ml, l, tsp, tbsp/T, cup/c, fl oz, pint, quart, gallon, pinch = 1/16 tsp, dash = 1/8 tsp) converts **only through the food's own
  USDA volume portion** (density). It picks the portion closest in size to the request, then the plainest description. It **never guesses a density**:
  if the food has no volume portion, the result is "Unresolved".
- **Named portions** ("large", "slice", "clove", "can"): matched against portion descriptions; among several matches the "regular/medium" one wins
  over "snack-size/thin". Size words with no matching size fall back to the standard item ("1 banana").
- **No unit** ("2 eggs"): the food's natural item (a portion named after the food, then serving/medium/piece/… hints; eggs default to "large").
- **Text parsing** (`QuantityTextParser`): fractions and unicode fractions, mixed numbers, ranges (midpoint), number words ("half a pound",
  "a dozen", "one and a half"), "2 (14.5 oz) cans" → 29 oz, preparation after commas, parenthetical notes, "to taste/optional".
- **Recipe ingredient matching** adds: a noise-word cleaner (chopped, minced, florets, softened…), trying the next close candidate (within 20
  ranker points) when the top match can't convert the unit, and borrowing a measure from a **nutritionally equivalent** food (calories ±8 %,
  macros ±15 %) with an explanatory note. Ingredients below score 45 are left **Unmatched** for the user to fix.

### 3.6 Planned vs. logged

- **Logged** = diary entries (count toward totals).
- **Planned** = plan entries with status `Planned`; shown in Week and on Today (redesign) with a **Planned** badge and a one-tap **Log** button.
- `Eaten` plan entries disappear from planned lists (the linked diary entry shows instead). `Skipped` entries remain visible in Week (muted).
- Batch cooking creates multiple plan entries sharing a `batch_id`; the grocery list counts the whole batch once.

---

## 4. Recipes & meal planning

### 4.1 Import & parsing

- **Paprika** ✅: accepts `.paprikarecipes` (ZIP of gzip-compressed JSON per recipe) or a single `.paprikarecipe`. Maps name, ingredients
  (newline-separated), directions, description, notes, servings text ("Serves 6-8" → 6, conservative), times, source/URL, image URL,
  base64 photo (stored in the DB), categories, rating, uid (re-import updates instead of duplicating), and Paprika's own nutrition text
  (shown for comparison only). Section headers ("FOR THE SAUCE:", ALL-CAPS lines) are ignored for nutrition.
- **Web page** ✅/☑️: fetches HTML (5 MB cap, public IPs only, redirects checked), extracts schema.org `Recipe` JSON-LD (handles `@graph`,
  arrays, `@type` arrays, HowToStep/HowToSection, ISO-8601 durations, HTML entities). Pages without JSON-LD are rejected with a clear message.
- **AI ideas** (only with a Claude key): `ClaudeRecipeIdeaGenerator` returns names, servings, ingredient lines and steps (no numbers);
  the app prices them by running the normal ingredient matcher; the user can save them as recipes.
- **Manual creation**: API supports it (`POST /recipes`), but **there is no recipe editor screen**.

### 4.2 Nutrition calculation

- Per ingredient: matched food × grams → `RecipeNutritionCalculator` sums → divides by servings → **cached** on the recipe with a
  **coverage** ratio (share of non-ignored lines that count). The UI shows "% of ingredients matched" and highlights lines needing attention.
- Users can fix a line (choose a different food and amount) or exclude it; recalculation is immediate.
- `CookedWeightGrams` (log a serving by weight) exists in the domain but **has no UI** ⚠️.

### 4.3 Scaling

- Logging/planning a recipe takes a **servings** number; nutrition scales linearly.
- Grocery list scales ingredient grams by planned servings ÷ recipe servings.
- There is **no UI to change a recipe's base servings** or to scale the ingredient list for display ⚠️.

### 4.4 Weekly planning

- Week = 7 days from the configured week start (default Monday). Per day: base target, adjusted target, eaten, still planned, projected.
- **Budget modes**: Daily (no carry-over) or Weekly: the over/under from past days is spread across today and the remaining days,
  capped at ±15 % per day (`MaxDailyAdjustment`). Anything that can't be absorbed is reported. **Past days with nothing logged count as on target**
  (treated as "not tracked", not as zero).
- **Rebalance proposal**: for each remaining day whose plan is ≥ 60 % of the room left and off by > 5 %, propose one scale factor
  (clamped 0.5–1.5) for all of that day's planned portions; the user applies it with one tap.

### 4.5 Pantry & grocery

- **Pantry**: items with name, optional linked food, optional grams, optional use-by date, staple flag (API). UI: add by name + "use within
  2/4/7 days"; remove. "What can I make" ranks recipes by missing non-staple ingredients (≤ 3), then whether it uses something expiring within
  3 days, then match %. Matching = same food id, or every word of the pantry name appears in the ingredient (stemmed). Assumed staples: salt,
  pepper, water, oils, sugar, flour, baking soda/powder, etc.
- **Grocery**: from planned (not eaten/skipped) entries in a date range (UI: today → end of week), merged by food, minus pantry, grouped into
  store aisles (`Aisles` keyword rules), with friendly amounts (g/kg + oz/lb + "≈ 3 banana" for natural items). Items under 1 g are hidden.
  Share as text. **Check-offs are not persisted.**

---

## 5. Nutrition intelligence

### 5.1 Targets

- Stored as one row: calories (default 2000), protein/carbs/fat grams (defaults 120/200/67), budget mode, week start, max daily adjustment,
  micronutrient overrides, focus nutrients.
- Micronutrient defaults = **FDA Daily Values** (adult label values, sex-neutral); each is Goal or Limit (sodium, saturated fat, added sugars,
  cholesterol, trans fat are limits).
- Targets UI edits calories, macros, budget mode and micronutrient overrides; shows a warning if macros don't add up to the calorie target.

### 5.2 Micronutrient tracking

- ~35 nutrients tracked from USDA data (see `NutrientCatalog`). Quick-calorie entries and some foods lack micronutrients, so totals are lower bounds.
- **Today** (redesigned): nutrients ranked over-limit first, then goals furthest below target; top 4 shown; "See all" sheet grouped into
  "Needs attention" / "On track". Status thresholds: Goal low < 50 %, fair < 90 %, met ≥ 90 %; Limit over > 100 %.
- **Heatmap**: nutrients × days, % of target, levels low/fair/good (goals) and good/high/veryHigh (limits); days with nothing logged are "none"
  and excluded from averages; highlights list consistently low (< 70 % average) and over-limit nutrients.

### 5.3 Fill Gaps algorithm (`GapFillService` + `GapFiller`)

- **Remaining** = daily targets − eaten − (by default) still-planned food for that date.
- **Targets considered** (weights): energy 4, protein 3, carbs 1, fat 1, fiber 1.5, limit nutrients 1, other focus nutrients 0.4.
- **Candidates**: favourite or previously logged recipes with ≥ 80 % coverage (½-serving steps, up to 2 servings); foods logged in the last 90 days
  (at the user's usual amount); pantry foods; and **starter staples** (20 nutrient-dense USDA foods) when there are fewer than 25 candidates.
  Food portions step in ≈ quarter servings up to 1.5 × a typical serving (≤ 300 g); the typical serving comes from USDA "NLEA serving" when present.
- **Objective**: weighted squared shortfall normalized by daily target; calorie **overshoot costs 3×**; goals penalize only shortfall; limits only
  excess; a small per-item penalty favours fewer items; a preference bonus for favourites/pantry/history.
- **Search**: tune each candidate's quantity, keep the best 30, grow combinations up to 3 items with per-item re-tuning; return up to 3 distinct
  suggestions with a plain-language summary ("leaves 49 kcal; protein met; completes Zinc, Folate").
- **UI**: "Add to plan" adds every item of a suggestion as plan entries for the selected date, all to the current time-of-day meal.

### 5.4 AI integrations

| Integration | Where | Model (configurable) | Status |
|---|---|---|---|
| Text/voice interpretation | `ClaudeInterpreter` | `Claude:InterpreterModel` (default `claude-opus-5-5`) | ☑️ Implemented and unit-tested for response mapping; **not exercised live in development** (no key in dev). Production depends on whether the owner set a key. |
| Recipe ideas | `ClaudeRecipeIdeaGenerator` | `Claude:RecipeModel` (default `claude-opus-5-5`) | ☑️ same as above |
| Rule-based fallback | `RuleBasedInterpreter` | — | ✅ default when no key or on error |

AI never supplies nutrient values; all numbers come from the database and the matcher.

---

## 6. Current UI

### 6.1 Two styling systems (transition in progress)

| | Legacy (all screens except Today) | New design system (Today + shared navigation) |
|---|---|---|
| Tokens | `src/lib/theme.ts` (blue primary `#1c5cab`, static `StyleSheet`) | `src/theme/tokens.ts` (spec v1: primary `#287968`, background `#F7F8F6`, …) |
| Components | `src/components/ui.tsx` (Card, Button, Chip, Field, Loading, ErrorView, Empty, QualityBadge), `charts.tsx` (old ring, bars, HeatCell, MacroLine), `ItemRow`, `AmountPicker` | `src/components/ds/*` |
| Theming | none | `ThemeProvider`, `useTheme`, `useStyles`, `useReducedMotion`, `useLargeText` |
| Icons | some emoji in legacy screens | Lucide via `src/components/ds/icons.ts` |

**Design tokens (new)**: light palette per spec v1, with derived `successText/warningText/errorText` for accessible small text; a full **dark
palette is defined but disabled** (`FORCED_COLOR_SCHEME = 'light'`, app.json `userInterfaceStyle: "light"`) until all screens migrate.
Macro colors (CVD-validated set): protein `#2A78D6`, carbs `#EDA100`, fat `#D55181`. Gold sits near the warning hue and magenta near the error hue, so
status is never shown by color alone. Spacing 8-pt (+4), screen padding 20, card radius 16, button radius 12, touch target 48. Typography uses
the platform font (Roboto on Android) with spec sizes and tabular numerals. Motion 150/200/250 ms; reduced motion honored.

### 6.2 Shared components (new, `src/components/ds/`)

`AppText` (variants + tones + tabular numbers), `AppCard`, `SectionHeader`, `PrimaryButton`, `SecondaryButton` (incl. danger tone),
`TextButton`, `IconButton` (ghost/tonal/outline, labelled), `SearchField`, `FilterChip`, `Badge`, `MacroProgress`, `NutrientProgress`
(icon + word + number), `CalorieRing`, `FoodRow` (stacked layout at large text), `RecipeCard` (built, **not yet used**), `EmptyState`,
`Skeleton`, `BottomSheet` (modal, keeps caller's draft, scrolls within 90 % height), `ConfirmationSheet` (built, **not yet used**),
`SnackbarProvider`/`useSnackbar` (single Undo bar; commits deferred actions on timeout or when replaced).

### 6.3 Today screen (redesigned) — structure

Header (prev/next day, title, full date, "Back to today" when off-day) → **Summary card** (ring + remaining kcal, eaten · goal, three labelled macro
bars) → **Log food** (primary) + **Scan** + **Voice** (tonal) → **Recent** chips (one-tap add to the time-of-day meal, Undo) → **Meals**
(Breakfast/Lunch/Dinner/Snacks; collapsible; empty meals as one dashed row; logged rows open an **edit sheet** for amount/meal/delete; planned rows
show **Planned** badge + **Log**) → **Nutrients** card (top needs, See all sheet, **Fill gaps**). Skeleton loading; error states for 401/unreachable
with "Open settings". Large text (≥ 130 % font scale) switches rows to stacked layouts.

### 6.4 Navigation patterns

- Bottom tabs (Lucide icons: House, CalendarDays, MessageCircle, ChefHat, Menu). Today hides the tab header and draws its own.
- Modals: food search, quick add (modal), scan (full screen). Other flows push stack screens.
- Legacy screens use `Alert.alert` action menus (e.g. Week entry actions, recipe ingredient fix). **Alerts do not render on web**, which limits those
  flows in the web app (see §7.2).

---

## 7. Known issues

### 7.1 Incomplete functionality

- No recipe editor (name, servings, ingredient lines, directions) although `PUT /recipes/{id}` exists.
- No UI for: copy meal/day, re-log past entries, move/swap/rescale individual plan entries, food "verify", recipe re-match, pantry edit/quantity/staple.
- Targets: week start, max daily adjustment and focus nutrients are not editable.
- `CookedWeightGrams` (serving by weight) unused.
- Grocery check-offs are not persisted.
- Undo is not available for "Log" on a planned meal (no "un-eat" endpoint).
- Branded USDA foods not loaded by default (barcode coverage relies on Open Food Facts).
- No accounts/multi-user, no offline mode, no data export.
- iOS build untested; Play Store release not set up.

### 7.2 UX limitations

- Only Today follows the new design spec; other screens are visually inconsistent with it (two color systems, emoji in places).
- Legacy flows rely on `Alert.alert` menus: **on the web build these menus do not appear**, so e.g. Week entry actions ("I ate this", "Ate a bit more ×1.25", Skip, Remove),
  recipe ingredient "Choose food / Exclude", pantry "Remove" and "Delete recipe" confirmations are not usable
  on web, and success/error messages ("Saved", "Could not save", "Added to plan") are silent there. (Today's equivalents use bottom sheets
  and an Undo bar, and work on web.)
- Today's Recent chips and Fill Gaps "Add to plan" use the **current time-of-day meal**, even when viewing another date.
- "N need attention" counts every nutrient below 90 %, which reads as alarming early in the day.
- Planned "Log" has no amount adjustment on Today (Week offers ×1.25).
- Dark mode not available yet.
- Voice and camera behavior not verified on a physical device.

### 7.3 Technical debt

- Two styling systems and two sets of components coexist (`lib/theme.ts` + `components/ui.tsx` vs `theme/` + `components/ds/`).
- No automated tests for the mobile app in the repo (Today was verified with ad-hoc Playwright scripts that are not committed).
- Some list endpoints load data into memory and filter there (recipes list/search, frequent items over the lookback window): fine for one user, not for many.
- CORS allows any origin; the API key is a single shared secret stored in plain AsyncStorage/localStorage on the client.
- The Android APK is signed with the standard Expo template debug key (fine for personal sideloading, not for Play Store).
- Web dev-mode console warning about a `collapsable` attribute (from SVG/icon rendering on web); harmless.
- `neon.ts`/`package.json` at the project root come from the Neon CLI and are not used by the running app.

### 7.4 Potential data-integrity problems

1. **`plan_meal` intent logs instead of planning** ⚠️: when Claude classifies a message as planning ("plan pizza for Friday dinner"), the
   assistant falls through to food matching and the Ask screen's **Add** button **logs a diary entry on that (possibly future) date**
   rather than creating a plan entry. Only reachable when a Claude key is configured.
2. **Snapshots don't follow food edits**: diary/plan entries keep the nutrition from the moment they were created; editing a food's data later
   does not update history (intended), and recipes' cached per-serving nutrition is only recalculated when the recipe's ingredients change.
3. **Undo of an edit uses the inverse scale**: amounts/nutrients are rounded to 3 decimals each time, so repeated edit/undo can drift by
   tiny amounts (≈ 0.001).
4. **Deferred delete**: deletes are committed after the 5 s Undo window (or when the next Undo bar replaces it, or the provider unmounts). If the
   app is killed inside that window, the delete never reaches the server and the entry reappears.
5. **Time zones**: the client uses the device's local date; the server's "today" (used to decide which week days are past) uses `App:TimeZone`
   (falls back to the server's zone, typically UTC on hosting). If not set to the user's zone, weekly budget boundaries can be off by a day near midnight.
6. **Unverified data sources**: Open Food Facts and user labels can be wrong; inconsistent ones are flagged but still usable.
7. **Unit conversions** may borrow a measure from a nutritionally equivalent food; this is noted on the ingredient but could surprise users.
8. **Single-row targets and no owner ids**: if the instance is ever shared, all users would share data and targets.

---

## 8. Development roadmap

### 8.1 Planned / agreed next steps

| Item | Source | Status |
|---|---|---|
| Review Today redesign; then redesign Week, Ask, Recipes, Pantry, Grocery, Fill Gaps, More per Design Spec v1 | Owner's spec | 🗓 waiting for review |
| Enable dark mode once all screens use the new tokens | Owner decision | 🗓 |
| Replace remaining emoji/legacy components; delete `lib/theme.ts` and legacy components after migration | Spec / tech debt | 🗓 |
| Fix `plan_meal` intent to create plan entries | §7.4 | 🗓 (identified, not scheduled) |
| Accounts (owner ids + real auth) | `docs/ARCHITECTURE.md` "Next steps" | 🗓 |
| Offline cache / queued mutations | same | 🗓 |
| Paid data tier (Nutritionix/FatSecret as extra barcode providers) | same | 🗓 |
| iOS build | same | 🗓 |
| Photo logging (photo → candidate foods, still confirmed, numbers from DB) | same | 🗓 |
| Google Play (internal testing) with a proper signing key | discussed | 🗓 optional |
| Adaptive calorie / TDEE estimation | — | ❌ explicitly excluded by the owner |

### 8.2 Architectural constraints to respect

- **Numbers come from the database, never from the AI.** Any AI feature may only structure input or suggest candidates.
- **Preserve business logic and API behavior** when redesigning UI; redesigned screens must use the existing hooks/endpoints.
- **Totals = diary only.** Planned food must never be counted as eaten; logging a planned item must go through `POST /plan/{id}/eaten`
  (no duplicate entries).
- **Snapshots are intentional** (history doesn't change when foods are edited).
- **Unit conversion never guesses densities**; unresolved amounts must be confirmed by the user.
- **New UI uses `src/theme` tokens and `src/components/ds`**, imports icons only from `src/components/ds/icons.ts` (lint-enforced), keeps
  48 dp targets, labels every icon-only button, and never conveys status by color alone.
- **Android-first, web must keep working** (the owner uses the web build daily). Avoid `Alert.alert` for anything essential (no-op on web);
  prefer bottom sheets.
- **App stays light-only** until every screen supports dark mode (single switch in `tokens.ts` + app.json).
- **Single-user assumptions** (singleton targets, no owner ids) are baked into the schema; multi-user requires a migration.
- **Dependencies**: Expo SDK 58 / RN 0.88 / React 19.3; install native packages with `npx expo install`; adding native modules requires a new APK build
  (GitHub workflow), while JS-only changes deploy to web via Render.

---

## Appendix A — API surface (all under `/api`, `X-Api-Key` header when the server has a key)

| Area | Endpoints |
|---|---|
| Foods | `GET /foods/search?q&limit`, `GET /foods/match?text`, `GET /foods/barcode/{code}`, `GET /foods/{id}`, `GET /foods/{id}/quantity?amount&unit`, `POST /foods`, `POST /foods/{id}/verify`, `GET /nutrients` |
| Diary | `GET /diary/{date}`, `GET /diary/quick-log?meal&limit`, `POST /diary/food`, `POST /diary/foods` (several foods, all-or-nothing), `POST /diary/recipe`, `POST /diary/quick`, `POST /diary/copy`, `POST /diary/{id}/relog`, `PATCH /diary/{id}`, `DELETE /diary/{id}` |
| Plan | `GET /plan/week?date`, `POST /plan/food`, `POST /plan/foods` (several foods, all-or-nothing), `POST /plan/recipe`, `POST /plan/batch`, `POST /plan/{id}/move`, `POST /plan/{id}/swap-recipe`, `POST /plan/{id}/swap-food`, `POST /plan/{id}/rescale`, `POST /plan/{id}/eaten`, `POST /plan/{id}/skip`, `DELETE /plan/{id}`, `GET /plan/rebalance?date`, `POST /plan/rebalance`, `GET /plan/gaps?date&includePlanned&micros&recipesOnly&maxItems`, `GET /plan/grocery?from&to&subtractPantry` |
| Targets | `GET /targets`, `PUT /targets` |
| Recipes | `GET /recipes?search&category`, `GET /recipes/{id}`, `GET /recipes/{id}/photo`, `POST /recipes`, `PUT /recipes/{id}`, `DELETE /recipes/{id}`, `POST /recipes/{id}/favorite`, `PUT /recipes/{id}/ingredients/{position}`, `POST /recipes/{id}/rematch`, `POST /recipes/import/paprika` (multipart), `POST /recipes/import/url` |
| Pantry | `GET /pantry`, `POST /pantry`, `PUT /pantry/{id}`, `DELETE /pantry/{id}`, `GET /pantry/what-can-i-make?maxMissing&search` |
| Other | `GET /insights/heatmap?date`, `POST /assistant`, `GET /status`; outside `/api`: `GET /health`, web app at `/` |

Errors are RFC 7807 problem details (404 not found, 400 validation, 401 missing/wrong key, 500 other).

## Appendix B — Configuration (names only, no values)

| Setting | Purpose |
|---|---|
| `DATABASE_URL` / `DATABASE_URL_UNPOOLED` / `ConnectionStrings:NutriPlan` | Database; the direct (unpooled) URL is preferred because migrations run at startup |
| `Api:Key` (`Api__Key`) | Shared API key; when set, `/api/*` requires `X-Api-Key` |
| `App:TimeZone` | IANA zone for the server's "today" |
| `Claude:ApiKey`, `Claude:InterpreterModel`, `Claude:RecipeModel`, `Claude:UseServerSideFallback` | Optional AI |
| `Usda:SeedFolder` | Folder imported automatically when the foods table is empty (set in the Docker image) |
| `PORT` | Listen port on hosting providers |
| `EXPO_PUBLIC_API_URL` (build time, mobile) | Default server address baked into the APK |
| `NUTRIPLAN_API_URL` (GitHub Actions variable) / workflow input | Server address for APK builds |

## Appendix C — Verification performed

- Backend: 92 automated tests (domain, application with in-memory fakes, infrastructure incl. real-Postgres integration); run in CI on every push.
- Mobile: TypeScript strict type-check and Expo ESLint in CI; web export in CI. No unit/UI tests committed.
- Today redesign: checked in the production web export at 360×640, 393×851, 412×915 and at 1.0/1.3/2.0 text scale (web preview) with no
  horizontal overflow; 21 scripted interaction checks against the real API (edit/undo, deferred delete, planned → Log without duplicates,
  quick-add undo, nutrients sheet, mic permission denied/no microphone, unreachable server).
- Android APK: builds successfully in GitHub Actions; runtime on devices not verified by the developer.
