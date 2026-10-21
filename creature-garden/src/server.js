import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import express from 'express';
import session from 'express-session';
import { openStore } from './store.js';
import { makeOAuthClient, authUrl, verifyGoogleLogin, accessFor, requestAccess, decide } from './auth.js';
import { newCreature, act, greet, introduce, viewFor, advance, FOODS, STAGE_HOURS, HOUR_MS } from './sim.js';
import { randomGenome } from './genetics.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const env = process.env;
const config = {
  port: Number(env.PORT ?? 3000),
  publicUrl: env.PUBLIC_URL ?? 'http://localhost:3000',
  ownerEmail: (env.OWNER_EMAIL ?? 'moyler.angela@gmail.com').toLowerCase(),
  clientId: env.GOOGLE_CLIENT_ID ?? '',
  clientSecret: env.GOOGLE_CLIENT_SECRET ?? '',
  sessionSecret: env.SESSION_SECRET ?? crypto.randomBytes(32).toString('hex'),
  dataFile: env.DATA_FILE ?? path.join(here, '..', 'data', 'garden.json'),
  // Local testing only: lets you sign in as the owner without Google. Never set in production.
  devLogin: env.DEV_LOGIN === 'true',
};

const store = openStore(config.dataFile);
const oauth = config.clientId ? makeOAuthClient(config) : null;

function seedGarden() {
  if (Object.keys(store.data.creatures).length) return;
  const now = Date.now();
  // Starters begin as grown-ups so they can court and breed right away.
  const grownUp = now - (STAGE_HOURS.youth + 1) * HOUR_MS;
  for (let i = 0; i < 4; i++) {
    const c = newCreature({ genome: randomGenome(), now: grownUp });
    c.lastTick = now; // age from the past, but start fed and rested
    store.data.creatures[c.id] = c;
  }
  store.save();
}
seedGarden();

const app = express();
app.use(express.json());
app.use(session({
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: config.publicUrl.startsWith('https://'), maxAge: 7 * 24 * 3600 * 1000 },
}));
app.use(express.static(path.join(here, '..', 'public')));

// Access is re-checked against the allowlist on every request, so revoking
// someone takes effect immediately rather than when their session expires.
function currentUser(req) {
  const user = req.session.user;
  if (!user) return null;
  const access = accessFor(user.email, store, config.ownerEmail);
  user.access = access === 'none' ? 'pending' : access;
  return user;
}

function requireApproved(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Sign in first.' });
  if (user.access !== 'owner' && user.access !== 'approved') return res.status(403).json({ error: 'Access not approved yet.' });
  next();
}

function requireOwner(req, res, next) {
  const user = currentUser(req);
  if (!user || user.access !== 'owner') return res.status(403).json({ error: 'Owner only.' });
  next();
}

// ---- Auth -------------------------------------------------------------------

app.get('/auth/google', (req, res) => {
  if (!oauth) return res.status(500).send('Google sign-in is not configured (GOOGLE_CLIENT_ID missing).');
  req.session.oauthState = crypto.randomBytes(16).toString('hex');
  res.redirect(authUrl(oauth, req.session.oauthState));
});

app.get('/auth/google/callback', async (req, res) => {
  try {
    if (!oauth || req.query.state !== req.session.oauthState) return res.status(400).send('Sign-in failed: state mismatch.');
    const profile = await verifyGoogleLogin(oauth, config.clientId, req.query.code);
    const access = accessFor(profile.email, store, config.ownerEmail);
    if (access === 'none') requestAccess(profile.email, profile.name, store);
    req.session.user = { ...profile, access: access === 'none' ? 'pending' : access };
    res.redirect('/');
  } catch (err) {
    console.error('Google sign-in failed:', err);
    res.status(500).send('Sign-in failed. Please try again.');
  }
});

// Local-only sign-in for development (enabled with DEV_LOGIN=true).
if (config.devLogin) {
  app.get('/auth/dev', (req, res) => {
    const email = String(req.query.email ?? config.ownerEmail).toLowerCase();
    const access = accessFor(email, store, config.ownerEmail);
    if (access === 'none') requestAccess(email, email, store);
    req.session.user = { email, name: email, access: access === 'none' ? 'pending' : access };
    res.redirect('/');
  });
}

app.post('/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Not signed in.' });
  res.json({ email: user.email, name: user.name, access: user.access });
});

// ---- Garden -----------------------------------------------------------------

function allCreatures() {
  return Object.values(store.data.creatures);
}

app.get('/api/garden', requireApproved, (req, res) => {
  const now = Date.now();
  const byId = store.data.creatures;
  const userId = req.session.user.email;
  const creatures = allCreatures().map((c) => {
    advance(c, now);
    return viewFor(c, userId, now, byId);
  });
  store.save();
  res.json({ creatures, foods: FOODS });
});

app.get('/api/creatures/:id', requireApproved, (req, res) => {
  const c = store.data.creatures[req.params.id];
  if (!c) return res.status(404).json({ error: 'No such creature.' });
  const now = Date.now();
  advance(c, now);
  const line = greet(c, req.session.user.email, now);
  store.save();
  res.json({ creature: viewFor(c, req.session.user.email, now, store.data.creatures), line });
});

app.post('/api/creatures/:id/act', requireApproved, (req, res) => {
  const c = store.data.creatures[req.params.id];
  if (!c) return res.status(404).json({ error: 'No such creature.' });
  const { action, food } = req.body ?? {};
  const now = Date.now();
  try {
    const result = act(c, req.session.user.email, action, { food, now });
    store.save();
    res.json({ line: result.line, situation: result.situation, creature: viewFor(c, req.session.user.email, now, store.data.creatures) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/introduce', requireApproved, (req, res) => {
  const a = store.data.creatures[req.body?.a];
  const b = store.data.creatures[req.body?.b];
  if (!a || !b) return res.status(404).json({ error: 'Pick two creatures that exist.' });
  const now = Date.now();
  try {
    const result = introduce(a, b, req.session.user.email, now);
    if (result.baby) {
      store.data.creatures[result.baby.id] = result.baby;
    }
    store.save();
    res.json({ outcome: result.outcome, lines: result.lines, babyId: result.baby?.id ?? null });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---- Owner admin: approve or deny access -------------------------------------

app.get('/api/admin/access', requireOwner, (req, res) => {
  res.json({ requests: store.data.requests, allowed: store.data.allowed });
});

app.post('/api/admin/access/:email', requireOwner, (req, res) => {
  const email = req.params.email.toLowerCase();
  const { decision } = req.body ?? {};
  if (!['approve', 'deny', 'revoke'].includes(decision)) return res.status(400).json({ error: 'decision must be approve, deny or revoke.' });
  if (email === config.ownerEmail) return res.status(400).json({ error: 'The owner always has access.' });
  decide(email, decision, store, config.ownerEmail);
  res.json({ ok: true });
});

app.listen(config.port, () => {
  console.log(`Creature Garden on ${config.publicUrl} (port ${config.port})`);
  if (!oauth) console.log('Google sign-in not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.');
});

