# Creature Garden

A shared garden of simple, cute sim creatures. They have personalities, needs,
and memories of each person who visits. You can feed them, pet them, play with
them, bonk them, or matchmake them. Creatures that fall for each other have
babies, and babies inherit traits from both parents.

See [DESIGN.md](DESIGN.md) for the game design and roadmap.

## Run it

Requires Node 20+.

```bash
npm install
npm test          # engine and access-rule tests
npm start         # http://localhost:3000
```

For local testing without Google, start with `DEV_LOGIN=true` and open
`http://localhost:3000/auth/dev` (signs you in as the owner). Add
`?email=friend@example.com` to try the approval flow as someone else.
Never set `DEV_LOGIN` in production.

## Play on claude.ai (phones included)

The game is also published as a claude.ai page: https://claude.ai/artifact/WAxED1hxxATtSsfQqERnDY

- It runs the same engine (`src/`) in the browser and keeps the shared garden
  in the page's own database, so there is no server to run.
- Access is the page's **Share** menu: people you add as **Contributor** can
  play; **Viewers** can watch but not touch anything.
- Rebuild after changing the engine or `artifact/`: `npm install`, then
  `npm run build:artifact`, which writes `artifact/dist/creature-garden.html`
  for publishing.
- Opened outside claude.ai, the page runs a practice garden that isn't saved.

## Host the Google sign-in version on Render

`render.yaml` at the repo root sets everything up except the secrets.

1. Set up Google sign-in (next section). For the redirect URI, use
   `https://<your-service>.onrender.com/auth/google/callback`.
2. In Render: **New → Blueprint**, connect this GitHub repo, and pick the branch.
3. When asked, fill in `PUBLIC_URL` (`https://<your-service>.onrender.com`),
   `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
4. Deploy. The garden is saved on a 1 GB disk at `/var/data`, so it survives
   restarts and redeploys. Disks need Render's paid Starter plan; on the free
   plan the garden would reset whenever the service restarts.

Sessions are kept in memory, so everyone is signed out after a redeploy.

## Set up Google sign-in

1. In Google Cloud Console, create a project and configure the OAuth consent screen
   (External, add yourself as a test user while it is in testing mode).
2. Create credentials → OAuth client ID → Web application.
3. Add the authorized redirect URI: `https://YOUR-DOMAIN/auth/google/callback`
   (and `http://localhost:3000/auth/google/callback` for local use).
4. Set these environment variables:

| Variable | Meaning |
| --- | --- |
| `GOOGLE_CLIENT_ID` | From step 2 |
| `GOOGLE_CLIENT_SECRET` | From step 2 |
| `PUBLIC_URL` | Public base URL, e.g. `https://garden.example.com` |
| `SESSION_SECRET` | Long random string. Set it, or sessions reset on every restart |
| `OWNER_EMAIL` | Defaults to `moyler.angela@gmail.com`. Always allowed, and the only one who can approve people |
| `DATA_FILE` | Where the garden is saved. Defaults to `data/garden.json` |
| `PORT` | Defaults to 3000 |

## How access works

- Anyone can sign in with Google, but a new person lands on "Access request sent".
- The owner sees pending requests in the **Access requests** panel and can
  Approve, Deny, or later Revoke access. Revoking takes effect on the next request.
- Access is re-checked against the allowlist on every request.

## Project layout

```
src/
  server.js        Express app: Google sign-in, garden API, owner admin
  auth.js          Google OIDC helpers and the owner-approved allowlist
  store.js         JSON-file storage with atomic writes
  sim.js           Needs, actions, memory, matchmaking, breeding
  genetics.js      Genome creation, breeding, mutation, attraction rules
  personality.js   Temperament tuning (numbers only, no logic)
  dialogue.js      Line composition with memory callbacks
public/
  index.html, style.css, app.js   Front end (no build step, SVG creatures)
test/
  sim.test.js      Engine and access-rule tests
```

## Notes for going live

- The JSON store is fine for one server process. Move to a real database before
  scaling out, and use a session store other than the in-memory default.
- Set `PUBLIC_URL` to an `https://` address so session cookies are marked secure.
