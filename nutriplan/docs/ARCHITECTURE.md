# Architecture

```
mobile/ (Expo, TypeScript)                          backend/ (.NET 10)
┌───────────────────────────┐   HTTP/JSON   ┌───────────────────────────────────────────────────┐
│ src/app/      screens     │ ────────────▶ │ NutriPlan.Api          minimal API endpoints       │
│ src/api/      client+hooks│               │   └─ Endpoints.cs      thin: parse → service → DTO │
│ src/components UI, charts │               │ NutriPlan.Application  use cases (services) + ports│
│ src/lib       theme, utils│               │ NutriPlan.Domain       entities + pure rules       │
└───────────────────────────┘               │ NutriPlan.Infrastructure EF/Postgres, USDA, OFF,   │
                                            │                          Claude, web fetch         │
                                            └───────────────────────────────────────────────────┘
```

Dependencies point inward: Api → Infrastructure → Application → Domain. Domain has no packages at all;
Application only knows interfaces (`Abstractions/`) that Infrastructure implements. That's what makes every
rule testable without a database and every provider swappable.

## Where things live (and where to change them)

| I want to change… | Look in |
|---|---|
| Which nutrients are tracked, default targets | `Domain/Nutrients/NutrientCatalog.cs` (ids are USDA nutrient ids) |
| Unit conversion ("2 tbsp" → grams) | `Domain/Units/QuantityResolver.cs`, `Units.cs` |
| Parsing "1 ½ cups flour, sifted" | `Domain/Parsing/QuantityTextParser.cs` |
| Label sanity check (calories vs macros) | `Domain/Nutrients/EnergyConsistency.cs` |
| Weekly budget / "I strayed" math | `Domain/Planning/WeeklyBudget.cs` |
| Gap-filling optimizer | `Domain/Planning/GapFiller.cs` (scoring rules documented at the top) + `Application/Planning/GapFillService.cs` (candidates, portions) |
| Search ranking | `Application/Foods/FoodRanker.cs` (pure; unit-tested) + `Infrastructure/Persistence/Repositories.cs` (candidate SQL) |
| Everyday-word synonyms ("toast", "oj") | `FoodService.Synonyms` |
| Recipe ingredient matching | `Application/Recipes/RecipeService.MatchIngredientsAsync`, `IngredientQuery.cs` |
| Paprika / web-page import | `Application/Recipes/Import/` |
| Grocery aisles | `Application/Planning/GroceryService.cs` (`Aisles`) |
| Chat intents without AI | `Application/Assistant/RuleBasedInterpreter.cs` |
| Claude prompts, schema, models | `Infrastructure/Ai/` and `appsettings.json` → `Claude` |
| USDA import | `Infrastructure/Usda/UsdaImporter.cs` |
| Barcode sources | implement `IBarcodeProvider`, register in `Infrastructure/DependencyInjection.cs` (tried in order) |
| DB schema | entities + `Persistence/NutriPlanDbContext.cs`, then `dotnet ef migrations add <Name> --project src/NutriPlan.Infrastructure --startup-project src/NutriPlan.Api --output-dir Persistence/Migrations` |
| App colors / spacing | `mobile/src/lib/theme.ts` |
| API calls & cache invalidation | `mobile/src/api/hooks.ts` |

## Key decisions

**Numbers never come from the language model.** Claude returns *structure* (intent, food phrase, amount, unit,
raw/cooked) via structured outputs; the app looks foods up and converts amounts with USDA's own household measures.
Recipe ideas are priced by matching their ingredients, the same way imported recipes are.

**Per-100 g nutrients stored as jsonb** keyed by USDA nutrient id. One row per food, any number of nutrients,
no join on the hot path. Portions, recipe ingredients and diary items are jsonb too; they're always read with
their parent.

**Snapshots.** Diary and plan entries store the nutrition at the time they were added, so editing a food later
never rewrites history.

**Data trust is visible.** `FoodSource` + `DataQuality` drive ranking and the UI badge. Label/crowd data is
checked against 4/4/9 (fiber-aware) and flagged when it doesn't add up; USDA lab data is exempt (it uses
food-specific energy factors).

**Unit conversion never guesses a density.** If a food has no cup weight, the matcher tries a near-identical food
that does (same name, or same composition) and says so in the note; otherwise the amount is left for you to
confirm.

**Weekly budget is capped.** An overage is spread across remaining days, at most ±15 % per day (configurable);
anything that can't be absorbed is shown, not hidden. Unlogged past days count as on-target, not as zero.

**Gap filling is an optimizer, not a chatbot.** Weighted squared distance to remaining targets; overshooting
calories costs 3×; goals only penalise shortfall; limits only penalise excess. Beam search with per-item quantity
tuning over whole-step portions (≤1.5 × a normal serving). Swap in OR-Tools behind the same inputs if needed.

## Data sources

| Source | Used for | Notes |
|---|---|---|
| USDA Foundation | lab-analysed whole foods | many lack household measures; matcher compensates |
| USDA SR Legacy | broad whole foods, cup/tbsp weights | frozen 2018, still the best measure data |
| USDA Survey (FNDDS) | "as eaten" foods with everyday names | uses legacy nutrient numbers; importer translates |
| USDA Branded (optional) | ~450k packaged foods with UPCs | large; import with `--branded` |
| Open Food Facts | barcode fallback | crowd data, unit-converted, flagged when inconsistent, cached locally |

## Next steps (when it becomes a product)

1. **Accounts:** add `OwnerId` to foods (user-created only), recipes, diary, plan, pantry, targets; JWT auth
   (e.g. Supabase Auth, Entra External ID) replacing `ApiKeyMiddleware`.
2. **Offline:** persist TanStack Query cache; queue mutations.
3. **Paid data tier:** Nutritionix / FatSecret as extra `IBarcodeProvider`s + natural-language endpoints, gated by plan.
4. **iOS release:** same codebase; `eas build -p ios`.
5. **Photo logging:** photo → Claude vision → *candidate foods* (still confirmed and numbers from the DB).
