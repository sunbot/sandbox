# Sign-in and accounts

Intake Grid is invite-only. People sign in with Google through **Firebase Authentication**; the API checks every
request's Firebase ID token and keeps each person's data private to them. All nutrition data stays in Neon:
Firebase only answers "who is this" and stores nothing else.

## How it works

| Piece | What it does |
|---|---|
| App (web) | Firebase's Google popup (redirect if popups are blocked). Firebase keeps the session in the browser. |
| App (Android) | Google Credential Manager (`react-native-nitro-google-signin`) → Google ID token → `signInWithCredential` in Firebase. The Firebase session (incl. refresh token) is stored in **SecureStore**, never AsyncStorage. |
| App → API | `Authorization: Bearer <Firebase ID token>` (1-hour token, refreshed by Firebase). A 401 is retried once with a fresh token, then the app signs out. Tokens never go in URLs or logs. Every cached query is cleared on sign-out and when the account changes. |
| API | JwtBearer with `Authority = https://securetoken.google.com/<projectId>`: signature against Google's published keys (rotation handled through OIDC discovery), issuer, audience = project id, expiry, RS256 only, Google sign-ins only. The token's subject maps to an `AppUser` through `ExternalIdentity (provider, subject)` — never through email. |
| Access | Default and fallback policy: signed in **and** an active, invited app user. Public: `/health` and the static web app. `/api/account/session` needs only a valid token (it tells the app whether you have access). Owner only: `/api/account/invitations`, `/api/account/users`. |
| Data | Diary, plan, recipes (incl. photos), pantry, targets and label foods carry `owner_id`. Every repository query names the owner explicitly **and** EF query filters apply the same rule (tests show either one alone still isolates). Catalog foods (USDA, cached Open Food Facts / USDA Branded products) are shared. Idempotency keys and the food-search rate limit are per user. |
| Joining | A new Google account gets in only through an open invitation (14 days) for its **verified** email (stored as a SHA-256 hash). The owner can withdraw invitations and turn anyone's access off. |
| Existing data | The migration assigns every existing row to a placeholder "legacy owner" account. Only the Firebase user id set in `Auth:OwnerSubject` can claim it, once. Nobody gets it by being first to sign in. |

Production refuses to start without `Auth:FirebaseProjectId` (fails closed). The old shared `Api:Key` /
`X-Api-Key` is removed.

## One-time setup (owner)

1. **Firebase project**: console.firebase.google.com → Add project (Analytics not needed). Free (Spark) plan is enough.
2. **Authentication → Sign-in method → Google → Enable.** Set a support email.
3. **Authentication → Settings → Authorized domains**: add your Render host (e.g. `sandbox-pxdy.onrender.com`).
4. **Project settings → General → Your apps → Web app** (no hosting). Copy `apiKey`, `authDomain`, `projectId`, `appId`.
   These are public identifiers, not secrets (they are visible in any Firebase web app).
5. **Android app** in the same project: package `com.nutriplan.app`, plus the **SHA-1 of the key that signs the APK**.
   The CI build currently signs with Expo's template debug key, so after `npx expo prebuild --platform android`:
   `keytool -list -v -keystore android/app/debug.keystore -alias androiddebugkey -storepass android -keypass android`.
   (When the APK moves to a protected signing key, add that key's SHA-1 too.) No `google-services.json` is needed.
6. **Web client id**: Google Cloud console (same project) → APIs & Services → Credentials → "Web client (auto created
   by Google Service)" → Client ID (`…apps.googleusercontent.com`). Android sign-in asks Google for a token for this client.

### Where the values go

| Value | Render (environment) | GitHub → Settings → Variables (Actions) |
|---|---|---|
| projectId | `Auth__FirebaseProjectId` and `EXPO_PUBLIC_FIREBASE_PROJECT_ID` | `FIREBASE_PROJECT_ID` |
| apiKey | `EXPO_PUBLIC_FIREBASE_API_KEY` | `FIREBASE_API_KEY` |
| authDomain | `EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN` | `FIREBASE_AUTH_DOMAIN` |
| appId | `EXPO_PUBLIC_FIREBASE_APP_ID` | `FIREBASE_APP_ID` |
| web client id | — | `GOOGLE_WEB_CLIENT_ID` |
| your Firebase user id (after step 3 below) | `Auth__OwnerSubject` | — |

Render passes its environment variables to the Docker build, where the web app is built with the `EXPO_PUBLIC_*`
values. Only public identifiers ever go in `EXPO_PUBLIC_*`.

## Rollout (production)

Order matters; nothing here deletes data. Steps marked ⚠ change production and need the owner's go-ahead.

1. ⚠ **Back up.** In Neon, create a branch `pre-auth-backup` from `production` (instant, keeps a full copy), and
   optionally `pg_dump` it. Record row counts (diary, plan, recipes, pantry, targets, foods with source `User`).
2. Do the one-time setup above and set the Render and GitHub values (not `Auth__OwnerSubject` yet).
3. ⚠ **Merge and deploy.** On start the API applies migration `UserOwnership` before serving any request, so there is
   no window where old endpoints see owned data. From this moment the API needs a sign-in; until step 5 nobody
   (including you) can see the data. The current APK stops working (it sends the old key) until step 6.
4. Open the web app, **Continue with Google**. You'll see "Not invited yet" with **your account ID**. (It is also in
   Firebase → Authentication → Users → User UID.)
5. ⚠ Set Render `Auth__OwnerSubject` to that ID and let Render restart. Sign in again (Try again): you are the Owner and
   see all existing data. Check the row counts against step 1.
6. ⚠ Run the "Intake Grid Android APK" workflow, install the new APK, sign in.
7. Remove `Api__Key` from Render. Invite others from **More → Settings → People**.

`Auth__OwnerSubject` only matters until the claim; leaving it set is harmless (the legacy owner can be claimed once).

## Rollback

* **Before anyone else has data** (only the owner signed in): run the migration's Down step against the database,
  then redeploy the previous commit (`ce4bc0c`) and restore `Api__Key`:
  `DATABASE_URL_UNPOOLED=<direct Neon URL> dotnet ef database update UsdaBrandedVolumeBasis --project src/NutriPlan.Infrastructure --startup-project src/NutriPlan.Api`
  Down drops the account tables and `owner_id` columns and restores the single targets row; it refuses to run
  (and changes nothing) if any other account owns data.
* **After others have data**: rolling back would merge everyone's data, so restore the `pre-auth-backup` branch instead.
* The previous app version cannot run on the new schema (owner columns are required), so always roll back the database
  and the code together.

### Rehearsal (done on a disposable copy, 2026-11-21)

On a local Postgres copy of a database at `UsdaBrandedVolumeBasis` (44 diary, 9 plan, 5 recipes, 9 pantry, 1 targets,
13,608 foods + 1 label food): `UserOwnership` up → every table's content (minus `owner_id`) hashed identical, all private
rows owned by the legacy owner, label food private, catalog foods shared, defaults removed; down with another account's
pantry row → refused, transaction rolled back, schema unchanged; down without → content identical to before; up again →
identical. Production itself was not touched (and isn't reachable from the build sandbox).

## Managing people

**More → Settings → People** (owner only): invite a Google account by email, withdraw open invitations, turn a member's
access off or back on. A turned-off member gets "Access turned off" on their next request; their data is kept.

## Tests

`tests/NutriPlan.Api.Tests` runs the real API against a throwaway Postgres with tokens signed by a locally generated
RSA key (no Google credentials or network): missing, forged, unsigned, expired, wrong issuer/audience/provider tokens;
uninvited, unverified-email, revoked and non-owner accounts; owner claim; and two-user direct-ID attacks across diary,
plan, pantry, recipes (incl. photos), targets, label foods, search, quick-log and planned-meal links. App tests
(`src/auth/authFetch.test.ts`) cover the bearer header, refresh-once retry, no retry loop, and cache clearing on
account change.

## Known limits

* Android sign-in needs a native build (not Expo Go) and the signing key's SHA-1 registered in Firebase.
* A request racing a brand-new account's first sign-in can get a one-off 409; retrying succeeds.
* The web app's Firebase session lives in browser storage (standard for Firebase web); protect the device.
* The server address in Settings is trusted: tokens are sent to whatever server is configured there.
