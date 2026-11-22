# Deploy NutriPlan so you can use it anywhere

You end up with **one HTTPS address** that serves both the app and its API, for example
`https://nutriplan-xyz.onrender.com`:

- **Browser:** open the address on any computer or phone.
- **Android home screen:** open it in Chrome → ⋮ menu → **Add to Home screen**. It launches full-screen like an app.
- **Real Android app (optional):** build an APK that points at the same address (section 3).

Your data lives in a Postgres database that you own (free tier is fine for one person).

---

## 1. Create the database (Neon, free)

1. Sign up at **neon.tech** → **New project** (choose the region nearest you).
2. Copy the **connection string**. It looks like
   `postgresql://user:password@ep-something.us-east-2.aws.neon.tech/neondb?sslmode=require`.
   Keep it private.

Any Postgres 14+ works: Supabase, Railway, or your host's own Postgres. NutriPlan accepts this `postgres://…`
URL format directly in `DATABASE_URL`.

## 2. Deploy the app (Render, using the Dockerfile)

The code must be in a GitHub repo Render can see. This project lives in the `nutriplan/` folder of `sunbot/sandbox`.

1. Sign up at **render.com** with GitHub and allow access to the repo.
2. **New → Web Service** → pick the repo → branch `claude/nutrition-meal-planning-app-9e9qj9` (or `main` after you merge).
3. Settings:
   - **Root Directory:** `nutriplan`
   - **Runtime / Language:** Docker (it finds `nutriplan/Dockerfile`)
   - **Health check path:** `/health`
   - **Instance type:** the free one works but sleeps when idle, so the first open after a break takes about a minute. The cheapest paid instance stays awake.
4. **Environment variables:**

   | Key | Value |
   |---|---|
   | `DATABASE_URL` | the Neon connection string |
   | `Auth__FirebaseProjectId` | your Firebase project id. **Required: the API won't start without it.** Sign-in setup: [AUTH.md](AUTH.md) |
   | `EXPO_PUBLIC_FIREBASE_API_KEY`, `…_AUTH_DOMAIN`, `…_PROJECT_ID`, `…_APP_ID` | your Firebase web-app config (public values, used to build the web app) |
   | `Auth__OwnerSubject` | your Firebase user id, after your first sign-in (claims the existing data once) |
   | `App__TimeZone` | your time zone, e.g. `America/Chicago` (so "today" flips at your midnight) |
   | `Claude__ApiKey` | *(optional)* your Anthropic API key for smarter chat and recipe ideas |
   | `Usda__ApiKey` | *(optional)* free api.data.gov key for USDA FoodData Central: branded product search and USDA barcode lookups. Without it, branded search says it isn't set up and barcodes use Open Food Facts only |
   | `Claude__InterpreterModel` | *(optional)* `claude-haiku-5-5` to keep chat costs to cents a month |

5. **Create Web Service.** The first build takes several minutes (it builds the app and downloads USDA data).
   On first start it loads ~13,600 foods into the database in about 30 seconds.
6. Open the URL and **Continue with Google**. The first time you'll see "Not invited yet" with your account ID: set it as
   `Auth__OwnerSubject` (see [AUTH.md](AUTH.md)), let Render restart, then tap Try again. Leave the Server URL as is.

**Other hosts:** the same Dockerfile and environment variables work on Railway, Fly.io, Azure Container Apps, or a
$5 VM with `docker run`. The container listens on `$PORT` (default 8080).

## 3. Optional: an installable Android app (APK)

The home-screen web app covers most things. Build the native app if browser camera scanning or voice don't
behave well on your phone. Both always work in the native app.

On your PC (needs Node 22+), with a free account at **expo.dev**:

```bash
cd nutriplan/mobile
npm install
# Point the app at your deployment:
#   edit eas.json → build.preview.env.EXPO_PUBLIC_API_URL = "https://<your-app>.onrender.com"
npx eas-cli@latest login
npx eas-cli@latest build --platform android --profile preview
```

Expo builds it in the cloud (about 10–20 min) and gives you a link and QR code for an `.apk`. Open it on the
phone and allow "install unknown apps" for your browser. In the app: **More → Settings** → enter your API key.
Future JavaScript-only changes can be pushed without reinstalling (`eas update`), but that's optional.

## Updating

Push to the branch Render deploys from. Render rebuilds automatically, and database migrations run on startup.
Your data stays in Neon.

One-time data steps that a deploy doesn't do on its own are listed in the docs that introduce them, e.g. giving USDA
Foundation foods the measures of their linked SR Legacy food (`enrich-usda-portions`, see `docs/LOGGING.md`). Run them with a
dry run first, and only with a recent backup.

## Backups

Neon keeps point-in-time history on its free tier. For your own copy:
`pg_dump "<DATABASE_URL>" > nutriplan-backup.sql`.

## GitHub Actions (automatic checks, optional deploy trigger)

`.github/workflows/nutriplan-ci.yml` runs on every push and pull request that touches `nutriplan/`:

1. **Backend:** build, then all tests against a real Postgres, then a check that the database model matches the migrations.
2. **App:** type-check, lint, and the web export the Docker image uses.
3. **Deploy (only on `main`, only if both pass):** calls a Render deploy hook, if you add the secret below.

Render already redeploys on every push to the connected branch by default. To make it deploy only after the checks pass:
in Render, turn off auto-deploy for the service (Settings → Build & Deploy); copy its **Deploy Hook** URL; in GitHub
go to repo → Settings → Secrets and variables → Actions → **New repository secret** named `RENDER_DEPLOY_HOOK_URL`.
The workflow does nothing for deploys until that secret exists, so it's safe to leave as is.

Copilot: with a Copilot plan, ask it for a review on a pull request, or use the Copilot chat in GitHub to extend this workflow.

## Android app without a computer (GitHub builds the APK)

`.github/workflows/nutriplan-android.yml` builds an installable APK in GitHub's cloud and publishes it at
`https://github.com/<owner>/<repo>/releases/tag/android-latest`.

1. (Optional) Repo → Settings → Secrets and variables → Actions → **Variables** → add `NUTRIPLAN_API_URL` = your Render address,
   so the app already knows its server. Or skip it and type the address in the app under More → Settings.
2. Repo → **Actions** → "NutriPlan Android APK" → **Run workflow** (it can also take the address as an input).
   The workflow file has to be on the repo's default branch for the Run button to appear; it also runs by itself when the file changes.
3. When it finishes (about 10–20 minutes), open the Release page **on your phone**, tap `NutriPlan.apk`, and install
   (allow "install unknown apps" for your browser when asked). Then enter your API key under More → Settings.

Each build gets a higher version number, so a new APK installs over the old one and keeps your settings.
The APK is signed with the standard Expo template key, which is fine for a personal sideloaded app but not for publishing
to the Play Store. For Play, create your own upload key.
