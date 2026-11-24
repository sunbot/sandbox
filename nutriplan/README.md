# Intake Grid

> Formerly "NutriPlan". Code, folders and the Android package id (`com.nutriplan.app`) keep the old name so installs update in place.

A personal nutrition tracker in the spirit of Cronometer, plus the parts Cronometer doesn't have:
**meal planning with recipes, a week view that adapts when you stray, and suggestions that fill the
gaps in your calories, macros and nutrients.** Log by search, barcode, voice, or plain-language chat.

> Accuracy rule: the AI only *understands* what you say. Every number comes from the food database
> (USDA FoodData Central, labels you enter, or Open Food Facts for barcodes), and every food shows
> where its numbers came from.

## What's here

| | |
|---|---|
| **Today** | Calorie ring, macro bars, key nutrients, meals; one-tap quick-add of your usual foods. |
| **Search / scan / speak** | Ranked USDA search (prefers plain, raw, trusted foods and what you eat often), barcode scanning (local DB → Open Food Facts → "add from label"), voice input. |
| **Ask** | Chat or talk: "2 eggs and toast for breakfast", "half a pound of chicken breast", "Christmas cookie recipes", "what can I make with what I have?", "what should I eat to hit my protein?". You get choices with amounts and nutrition; nothing is logged until you tap. |
| **Week** | 7 days of planned vs. eaten. Weekly budget mode spreads an overage across the remaining days (capped per day); a banner offers to rescale the rest of the plan. "I ate this" turns a planned meal into a log entry. |
| **Fill the gaps** | An optimizer picks 1–3 foods/recipes (from what you eat, your pantry, favourites, and nutrient-dense staples) at realistic portions to land on your remaining calories, protein and nutrient targets. |
| **Recipes** | Import **Paprika** exports (`.paprikarecipes`) or any recipe link (schema.org data). Each ingredient is matched to a food and converted to grams using USDA household measures; nutrition per serving is computed, unmatched lines are highlighted to fix. |
| **Grocery list** | From the plan, merged by food, batch recipes bought once, pantry subtracted, grouped by aisle, shareable. |
| **Pantry** | What you have (with use-by dates) and "what can I make" ranked by missing ingredients. |
| **Nutrient heatmap** | Nutrients × days, % of target, with highlights of what's consistently low or over. |
| **Targets** | Calories, macros, daily vs. weekly budgeting, and every micronutrient target (defaults: FDA Daily Values). |

## Stack

- **Backend:** ASP.NET Core 10 (minimal APIs) · EF Core + PostgreSQL · clean layers (Domain → Application → Infrastructure → Api) · xUnit (90 tests incl. real-Postgres integration).
- **App:** Expo SDK 58 / React Native (TypeScript) · Expo Router · TanStack Query · expo-camera (barcodes) · expo-speech-recognition (on-device voice).
- **Data:** USDA FoodData Central (Foundation, SR Legacy, Survey/FNDDS; optional Branded) · Open Food Facts for barcodes.
- **AI (optional):** Claude via the official Anthropic C# SDK, using structured outputs. Without a key, a built-in rule-based parser handles common phrases for free.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how it fits together and where to change things.

## Run it locally

Prereqs: .NET 10 SDK, Node 22+, Docker (or any Postgres 14+), Android Studio (for the emulator) or an Android phone.

```bash
# 1) Database
docker compose up -d

# 2) Food data (≈13k USDA foods; add --branded for ~450k packaged foods with barcodes)
./scripts/download-usda.sh

# 3) API  → http://localhost:5154  (applies DB migrations on start)
cd backend/src/NutriPlan.Api
dotnet run

# 4) App (first run builds a development app; camera + voice need it, Expo Go can't do them)
cd mobile
npm install
npx expo run:android        # emulator or USB-connected phone
```

In the app: **More → Settings → Server URL**. Emulator: `http://10.0.2.2:5154`. Phone on your Wi-Fi: `http://<your PC's LAN IP>:5154`.

Tests: `cd backend && dotnet test` (set `NUTRIPLAN_TEST_DB="Host=localhost;Username=nutriplan;Password=nutriplan;Database=postgres"` to include database tests).
App checks: `cd mobile && npx tsc --noEmit && npx expo lint`.

### Optional: Claude for smarter chat and recipe ideas

Set an API key (from console.anthropic.com) without committing it:

```bash
cd backend/src/NutriPlan.Api
dotnet user-secrets init
dotnet user-secrets set "Claude:ApiKey" "sk-ant-..."
```

**Your Claude.ai subscription doesn't include API usage** — the API is billed separately, pay-as-you-go.
Rough costs at current prices (input / output per million tokens: Claude Opus 5.5 $4 / $20, Claude Haiku 5.5 $0.10 / $0.50):

| Use | Opus 5.5 (default) | Haiku 5.5 |
|---|---|---|
| One chat/voice message (~1.5k tokens in, ~0.4k out) | ≈ $0.01–0.02 | ≈ $0.0004 |
| 20 messages a day for a month | ≈ $6–12 | ≈ $0.25 |
| One "give me 4 recipe ideas" request | ≈ $0.05–0.15 | ≈ $0.003 |

Switch models in `appsettings.json` (`Claude:InterpreterModel`, `Claude:RecipeModel`). Haiku is usually plenty for
food parsing; keep Opus for recipe ideas if you like their quality. Set a monthly spend limit in the Anthropic console.
Server-side refusal fallback is enabled for models that support it (`Claude:UseServerSideFallback`).

## Hosting for personal use (low cost)

**Step-by-step: [docs/DEPLOY.md](docs/DEPLOY.md)** covers a free Neon database, the app on Render via the Dockerfile
(browser and Android home screen), and an optional installable APK.


Easiest: run the API + Postgres on a home PC and reach it from your phone over Wi-Fi, or anywhere via
[Tailscale](https://tailscale.com) (free). For always-on hosting: a small VM (~$5–6/mo) running
`docker compose` + the API, or a managed Postgres free tier (Neon/Supabase) + any .NET host. When exposed to the
internet it requires Google sign-in (Firebase) and is invite-only: see [docs/AUTH.md](docs/AUTH.md).

## Going further

- **iOS:** the app is cross-platform; `npx expo run:ios` on a Mac, or build in the cloud with `eas build -p ios`.
- **More barcodes offline:** `./scripts/download-usda.sh --branded`.
- **Multi-user / product:** add an owner id to the tables + real auth (see ARCHITECTURE "Next steps"); tiering
  (free vs. paid data sources like Nutritionix/FatSecret) plugs in as more `IBarcodeProvider`s.

Data: USDA FoodData Central is public domain. Open Food Facts data is © Open Food Facts contributors, ODbL.
This app is a tracking tool, not medical advice.
