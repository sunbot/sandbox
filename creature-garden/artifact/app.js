// Creature Garden on claude.ai. The same engine as the server version
// (../src), with the shared garden kept in the page's own database:
//   creatures/<id>              one document per creature
//   events/<auto id>            one document per Gazette event
//   data/users/<id>/visit       each player's last visit (private to them)
// Who may play is decided by the claude.ai Share menu: Contributors and up
// play, Viewers watch. Without the database (opened outside claude.ai) the
// page runs a practice garden that is not saved.

import { newCreature, act, lure, introduce, tick, viewFor, greet, FOODS, STAGE_HOURS, HOUR_MS } from '../src/sim.js';
import { randomGenome } from '../src/genetics.js';
import { gazette } from '../src/gazette.js';
import { creatureSVG, KIND_LABEL, HEART_LABEL } from '../public/creature-art.js';

const app = document.getElementById('app');
const clone = (x) => structuredClone(x);
const EVENT_LIMIT = 300;
const EVENT_KEEP_MS = 14 * 24 * HOUR_MS;

// People are stored only by id. Text that names someone carries @@id@@,
// replaced with their current name when it is drawn.
const mark = (id) => `@@${id}@@`;
const MARK_RE = /@@(.+?)@@/g;

const state = {
  mode: 'loading',      // loading | shared | practice
  canWrite: true,
  meId: null,
  isOwner: false,
  creatures: {},
  events: [],
  lastSeen: 0,
  selectedId: null,
  pair: [null, null],   // the matchmaker's two picks, kept across redraws
  lastLine: '',
  introResult: '',
  notice: '',
  names: {},
  busy: false,
};
let db = null;
let user = null;
const requestedNames = new Set();

// ---- Storage ----------------------------------------------------------------

// Writes go out one at a time, as the database asks.
let writeChain = Promise.resolve();
function queueWrite(fn) {
  const next = writeChain.then(fn);
  writeChain = next.catch(() => {});
  return next;
}

async function commit(creatures, events) {
  if (state.mode === 'practice') {
    for (const c of creatures) state.creatures[c.id] = clone(c);
    state.events.push(...events);
    render();
    return;
  }
  for (const c of creatures) await queueWrite(() => db.doc(`creatures/${c.id}`).set(c));
  for (const e of events) await queueWrite(() => db.collection('events').add(e));
}

function handleWriteError(err) {
  if (err?.code === 'invalid_argument') {
    state.canWrite = false;
    state.notice = 'You can watch this garden, but the owner needs to give you Contributor access before you can play.';
  } else if (err?.code === 'quota_exceeded') {
    state.notice = 'The garden is full. The owner can clear out old Gazette news to make room.';
  } else if (err?.message) {
    state.notice = err.message;
  }
}

// Time passes on its own: creatures grow up and wander off between visits.
// Whoever has the page open saves those changes, holding a short lease so two
// open pages do not both write the same event.
const maintaining = new Set();
async function maintain() {
  if (state.mode !== 'shared' || !state.canWrite) return;
  for (const c of Object.values(state.creatures)) {
    if (maintaining.has(c.id) || !tick(clone(c), Date.now()).length) continue;
    maintaining.add(c.id);
    try {
      const ref = db.doc(`creatures/${c.id}`);
      const lease = await ref.acquire({ holder: state.meId ?? 'viewer', ttlMs: 15000 });
      if (!lease.acquired) continue;
      const fresh = await ref.get();
      if (!fresh.exists) continue;
      const updated = clone(fresh.data());
      const events = tick(updated, Date.now());
      if (events.length) await commit([updated], events);
    } catch (err) {
      handleWriteError(err);
    } finally {
      maintaining.delete(c.id);
    }
  }
}

// ---- Game actions -------------------------------------------------------------

async function run(fn) {
  if (state.busy) return;
  state.busy = true;
  try {
    await fn();
  } catch (err) {
    if (err?.code) handleWriteError(err);
    else state.lastLine = err.message;
  } finally {
    state.busy = false;
    render();
  }
}

function current(id) {
  const c = clone(state.creatures[id]);
  return { c, events: tick(c, Date.now()) };
}

function doAct(id, action, food) {
  return run(async () => {
    const { c, events } = current(id);
    const result = act(c, state.meId, action, { food, now: Date.now(), actorName: mark(state.meId) });
    state.lastLine = result.line;
    await commit([c], [...events, ...result.events]);
  });
}

function doLure(id, food) {
  return run(async () => {
    const { c, events } = current(id);
    const result = lure(c, state.meId, food, { now: Date.now(), actorName: mark(state.meId) });
    state.lastLine = result.line;
    await commit([c], [...events, ...result.events]);
  });
}

function doIntroduce(aId, bId) {
  return run(async () => {
    const a = current(aId);
    const b = current(bId);
    try {
      const result = introduce(a.c, b.c, state.meId, Date.now(), undefined, mark(state.meId));
      state.introResult = result.lines.join(' ');
      await commit([a.c, b.c, ...(result.baby ? [result.baby] : [])], [...a.events, ...b.events, ...result.events]);
    } catch (err) {
      if (err?.code) throw err;
      state.introResult = err.message;
    }
  });
}

// Four grown-up starters, for an empty garden.
function starters(now = Date.now()) {
  return Array.from({ length: 4 }, () => {
    const c = newCreature({ genome: randomGenome(), now: now - (STAGE_HOURS.youth + 1) * HOUR_MS });
    c.lastTick = now;
    c.lastStage = 'adult';
    return c;
  });
}

function hatchStarters() {
  return run(async () => {
    await commit(starters(), []);
  });
}

// ---- Names ------------------------------------------------------------------

function resolveNames(text) {
  const out = text.replace(MARK_RE, (_, id) => {
    if (id === state.meId) return 'you';
    if (!(id in state.names)) requestedNames.add(id);
    return state.names[id] || 'Someone';
  });
  return out.charAt(0).toUpperCase() + out.slice(1); // "you fed me" starts a diary line
}

async function fetchNames() {
  const ids = [...requestedNames].filter((id) => !(id in state.names));
  requestedNames.clear();
  if (!ids.length || !user) return;
  const profiles = await user.profiles(ids);
  for (const id of ids) state.names[id] = profiles[id]?.name || '';
  render();
}

// ---- Drawing ------------------------------------------------------------------

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (value !== undefined && value !== null && value !== false) node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function artNode(c) {
  const wrap = el('div', { class: 'art' });
  wrap.innerHTML = creatureSVG(c);
  return wrap;
}

function views(now) {
  return Object.values(state.creatures)
    .sort((x, y) => x.bornAt - y.bornAt)
    .map((c) => {
      const t = clone(c);
      tick(t, now);
      return viewFor(t, state.meId, now, state.creatures);
    });
}

function renderGazette(now) {
  const headlines = gazette(state.events, state.creatures, { now, lastSeen: state.lastSeen, limit: 6 });
  const date = new Date(now).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  return el('section', { class: 'gazette', 'aria-label': 'The Garden Gazette' },
    el('header', {},
      el('h2', { class: 'masthead' }, 'The Garden Gazette'),
      el('p', { class: 'dateline' }, `${date} · Price: one berry`)),
    el('ul', {}, headlines.map((h) => el('li', { class: `story ${h.kind}` },
      h.isNew ? el('span', { class: 'new' }, 'New') : null,
      resolveNames(h.text)))),
  );
}

function renderGrid(all) {
  return el('section', { class: 'garden', 'aria-label': 'The garden' },
    all.map((c) => el('button', {
      class: `critter${c.id === state.selectedId ? ' selected' : ''}${c.away ? ' away' : ''}`,
      'aria-pressed': c.id === state.selectedId ? 'true' : 'false',
      onclick: () => select(c.id),
    },
    artNode(c),
    el('span', { class: 'name' }, c.name),
    el('span', { class: 'sub' }, c.away ? `away · ${c.away.reason}` : `${c.temperament} · ${c.stage}`),
    )));
}

function select(id) {
  state.selectedId = id;
  const now = Date.now();
  const t = clone(state.creatures[id]);
  tick(t, now);
  state.lastLine = greet(t, state.meId, now);
  render();
  // On a phone the panel sits below the garden, so bring it into view.
  if (matchMedia('(max-width: 759px)').matches) {
    document.getElementById('panel')?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }
}

function meter(label, value, tone = '') {
  return el('div', { class: 'meter' },
    el('span', { class: 'label' }, label),
    el('span', { class: 'track' }, el('span', { class: `fill ${tone}`, style: `width:${Math.max(0, Math.min(100, value))}%` })),
    el('span', { class: 'value' }, String(value)));
}

function renderDiary(c) {
  return el('details', { class: 'diary', open: true },
    el('summary', {}, 'Diary'),
    c.diary.length
      ? el('ul', {}, c.diary.slice().reverse().map((d) => el('li', {}, resolveNames(d.count > 1 ? `${d.text} (×${d.count})` : d.text))))
      : el('p', { class: 'muted' }, 'Nothing written yet.'));
}

function renderPanel(c) {
  const playable = state.canWrite && !state.busy;
  if (c.away) {
    return el('section', { class: 'panel', id: 'panel' },
      el('div', { class: 'portrait away' }, artNode(c)),
      el('h2', {}, `${c.name} has wandered off`),
      el('p', { class: 'facts' }, c.away.reason === 'hungry' ? 'Left to find food' : 'Ran away, scared'),
      el('blockquote', { class: 'note' }, c.away.note),
      el('p', { class: 'bubble', 'aria-live': 'polite' }, state.lastLine && state.lastLine !== c.away.note ? state.lastLine : 'Leave food at the garden’s edge. Only a favourite will tempt them back.'),
      el('p', { class: 'muted' }, `Favourite snacks left so far: ${c.away.lures} of ${c.away.needed}`),
      el('div', { class: 'actions' }, FOODS.map((f) => el('button', { disabled: !playable, onclick: () => doLure(c.id, f) }, `Leave ${f}`))),
      renderDiary(c));
  }
  return el('section', { class: 'panel', id: 'panel' },
    el('div', { class: 'portrait' }, artNode(c)),
    el('h2', {}, c.name),
    el('p', { class: 'facts' },
      `${c.temperament} · ${c.stage} · generation ${c.generation}`,
      c.parents ? el('span', {}, ` · child of ${c.parents.join(' & ')}`) : null),
    el('p', { class: 'facts' }, `${KIND_LABEL[c.genome.sex]} · ${HEART_LABEL[c.genome.attracts]}`),
    el('p', { class: 'calls-you' }, c.you.nickname ? `Calls you “${c.you.nickname}”` : 'Has no name for you yet'),
    el('p', { class: 'bubble', 'aria-live': 'polite' }, state.lastLine || `${c.name} looks ${c.mood}.`),
    el('div', { class: 'meters' },
      meter('Full', c.fullness), meter('Energy', c.energy), meter('Affection', c.affection),
      meter('Likes you', Math.max(0, c.you.fondness)), meter('Fear of you', c.you.fear, 'fear')),
    el('div', { class: 'actions' },
      FOODS.map((f) => el('button', { disabled: !playable, onclick: () => doAct(c.id, 'feed', f) }, `Feed ${f}`)),
      el('button', { disabled: !playable, onclick: () => doAct(c.id, 'pet') }, 'Pet'),
      el('button', { disabled: !playable, onclick: () => doAct(c.id, 'play') }, 'Play'),
      el('button', { class: 'bonk', disabled: !playable, onclick: () => doAct(c.id, 'hit') }, 'Bonk'),
      el('button', { class: 'quiet', disabled: !playable, onclick: () => doAct(c.id, 'let_be') }, 'Let be')),
    c.friends.length ? el('p', { class: 'muted' }, `Friends: ${c.friends.map((f) => `${f.name} (${f.affinity})`).join(', ')}`) : null,
    renderDiary(c));
}

function renderMatchmaker(all) {
  const home = all.filter((c) => !c.away);
  const ids = home.map((c) => c.id);
  const pick = (i, fallback) => (ids.includes(state.pair[i]) ? state.pair[i] : fallback);
  const picker = (i, label, fallback) => {
    const chosen = pick(i, fallback);
    return el('select', { id: `pair-${i}`, 'aria-label': label, onchange: (e) => { state.pair[i] = e.target.value; } },
      home.map((c) => el('option', { value: c.id, selected: c.id === chosen }, `${c.name} (${c.temperament})`)));
  };
  const a = picker(0, 'First creature', ids[0]);
  const b = picker(1, 'Second creature', ids[1]);
  return el('section', { class: 'matchmaker' },
    el('h2', {}, 'Play matchmaker'),
    el('p', { class: 'muted' }, 'Introduce two creatures. They only fall for the kind on their card, and they are likelier to say yes if they like you.'),
    el('div', { class: 'pair' }, a, el('span', { 'aria-hidden': 'true' }, '♥'), b),
    el('button', { disabled: !state.canWrite || state.busy || home.length < 2, onclick: () => doIntroduce(a.value, b.value) }, 'Introduce them'),
    state.introResult ? el('p', { class: 'bubble', 'aria-live': 'polite' }, resolveNames(state.introResult)) : null);
}

function renderBanner() {
  if (state.mode === 'practice') {
    return el('p', { class: 'banner' }, 'Practice garden. Nothing here is saved. Open this page on claude.ai while signed in to play the shared garden.');
  }
  if (state.notice) return el('p', { class: 'banner' }, state.notice);
  if (state.isOwner) {
    return el('p', { class: 'banner' }, 'You own this garden. To let friends play, use Share and give them Contributor access. Viewers can only watch.');
  }
  return null;
}

function render() {
  const now = Date.now();
  if (state.mode === 'loading') {
    app.replaceChildren(el('p', { class: 'loading' }, 'Waking the garden…'));
    return;
  }
  const all = views(now);
  if (!all.length) {
    app.replaceChildren(renderBanner() ?? '', el('section', { class: 'empty' },
      el('h2', {}, 'The garden is empty'),
      el('p', { class: 'muted' }, 'Hatch a few starter creatures to begin. Babies come later, from good dates.'),
      el('button', { disabled: !state.canWrite || state.busy, onclick: hatchStarters }, 'Hatch four starter creatures')));
    return;
  }
  if (!state.selectedId || !state.creatures[state.selectedId]) state.selectedId = all[0].id;
  const selected = all.find((c) => c.id === state.selectedId);
  app.replaceChildren(
    renderBanner() ?? '',
    renderGazette(now),
    el('div', { class: 'layout' },
      el('div', { class: 'column' }, renderGrid(all), renderMatchmaker(all)),
      el('div', { class: 'column' }, renderPanel(selected))),
  );
  if (requestedNames.size) fetchNames();
}

// ---- Start ------------------------------------------------------------------

function startPractice() {
  state.mode = 'practice';
  state.meId = 'practice-player';
  for (const c of starters()) state.creatures[c.id] = c;
  render();
}

async function start() {
  render();
  [db, user] = await Promise.all([window.claude?.use?.('db') ?? null, window.claude?.use?.('user') ?? null]);
  if (!db || !user) return startPractice();
  const me = await user.me();
  if (!me.id) return startPractice();
  state.meId = me.id;
  state.isOwner = me.isOwner;
  state.canWrite = (await user.can('data.write')) !== false;
  state.mode = 'shared';

  db.collection('creatures').onSnapshot((snap) => {
    state.creatures = Object.fromEntries(snap.docs.map((d) => [d.id, d.data()]));
    render();
    setTimeout(maintain, 500 + Math.random() * 1500);
  }, (err) => { state.notice = 'The garden stopped updating. Reload the page to reconnect.'; render(); });

  db.collection('events').orderBy('at', 'desc').limit(EVENT_LIMIT).onSnapshot((snap) => {
    state.events = snap.docs.map((d) => d.data()).reverse();
    render();
  }, () => {});

  // When did this player last read the Gazette? Remember it for this visit,
  // then record today's visit.
  try {
    const visit = db.doc(`data/users/${state.meId}/visit`);
    const snap = await visit.get();
    state.lastSeen = snap.exists ? snap.data().lastSeen ?? 0 : 0;
    if (state.canWrite) await visit.set({ lastSeen: Date.now() });
  } catch {
    // Watching without write access: nothing to remember.
  }
  render();

  // The owner tidies away Gazette news older than two weeks.
  if (state.isOwner) {
    try {
      const old = await db.collection('events').where('at', '<', Date.now() - EVENT_KEEP_MS).limit(100).get();
      for (const d of old.docs) await queueWrite(() => db.doc(`events/${d.id}`).delete());
    } catch {
      // Tidying is best effort.
    }
  }

  // Needs keep changing while the page stays open.
  setInterval(() => { if (!document.hidden) { render(); maintain(); } }, 60000);
}

start();
