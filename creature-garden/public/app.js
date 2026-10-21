// Creature Garden front end. Plain DOM, no build step. User-supplied text is
// always set with textContent; the SVG only uses numbers and fixed strings.

import { creatureSVG, KIND_LABEL, HEART_LABEL } from './creature-art.js';

const app = document.getElementById('app');
const who = document.getElementById('who');
const state = { me: null, creatures: [], foods: [], selectedId: null, lastLine: '', introResult: '', gazette: null, newHeadlines: new Set() };

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status });
  return data;
}

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (value !== undefined && value !== null) node.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

// ---- Creature art -----------------------------------------------------------

function artNode(c) {
  const wrap = el('div');
  wrap.innerHTML = creatureSVG(c);
  return wrap.firstElementChild;
}

// ---- Screens ----------------------------------------------------------------

function renderLogin(message) {
  app.replaceChildren(el('div', { class: 'card login' },
    el('h2', {}, 'Welcome to the garden'),
    el('p', { class: 'muted' }, 'Sign in with Google. The owner approves who can visit.'),
    message ? el('p', { class: 'notice' }, message) : null,
    el('p', {}, el('a', { class: 'google', href: '/auth/google' }, 'Sign in with Google')),
  ));
}

function renderPending(me) {
  who.textContent = `${me.name} · waiting for approval`;
  app.replaceChildren(el('div', { class: 'card login' },
    el('h2', {}, 'Access request sent'),
    el('p', { class: 'notice' }, 'The owner has been asked to approve you. Come back once they say yes.'),
    el('p', {}, el('button', { class: 'ghost', onclick: logout }, 'Sign out')),
  ));
}

async function logout() {
  await api('/auth/logout', { method: 'POST' });
  location.reload();
}

async function loadGarden() {
  const [data] = await Promise.all([api('/api/garden'), loadGazette()]);
  state.creatures = data.creatures;
  state.foods = data.foods;
  if (!state.selectedId && state.creatures.length) state.selectedId = state.creatures[0].id;
  renderGarden();
}

// The server marks headlines that are new since your last visit. Keep that
// mark for the rest of this page session, even after later refreshes.
async function loadGazette() {
  const data = await api('/api/gazette');
  for (const h of data.headlines) if (h.isNew) state.newHeadlines.add(h.text);
  state.gazette = data;
}

function renderGazette() {
  if (!state.gazette) return null;
  const date = new Date(state.gazette.date).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  return el('div', { class: 'card gazette' },
    el('div', { class: 'masthead' }, el('span', {}, 'The Garden Gazette'), el('span', { class: 'muted' }, date)),
    el('ul', {}, state.gazette.headlines.map((h) => el('li', { class: h.kind },
      state.newHeadlines.has(h.text) ? el('span', { class: 'pill' }, 'NEW') : null,
      h.text))),
  );
}

function renderGarden() {
  const selected = state.creatures.find((c) => c.id === state.selectedId);
  const grid = el('div', { class: 'garden' }, state.creatures.map((c) =>
    el('div', {
      class: `critter${c.id === state.selectedId ? ' selected' : ''}${c.away ? ' away' : ''}`,
      role: 'button',
      tabindex: 0,
      onclick: () => { state.selectedId = c.id; state.lastLine = ''; renderGarden(); },
    },
    artNode(c),
    el('div', { class: 'name' }, c.name),
    el('div', { class: 'sub' }, c.away ? `wandered off · ${c.away.reason}` : `${c.temperament} · ${c.stage}`),
    )));

  app.replaceChildren(
    renderGazette(),
    el('div', { class: 'stage' },
      el('div', {},
        el('div', { class: 'card' }, grid),
        el('div', { class: 'card' }, renderIntroduce()),
      ),
      el('div', {}, selected ? (selected.away ? renderAway(selected) : renderCreature(selected)) : el('p', { class: 'muted' }, 'No creatures yet.'),
        state.me.access === 'owner' ? el('div', { class: 'card', id: 'admin' }, el('h3', {}, 'Access requests (owner)'), el('p', { class: 'muted' }, 'Loading…')) : null),
    ),
  );
  if (state.me.access === 'owner') loadAdmin();
}

function renderCreature(c) {
  const bar = (label, value) => el('div', { class: 'bar' },
    el('span', {}, label),
    el('div', { class: 'track' }, el('div', { class: 'fill', style: `width:${value}%` })),
    el('span', { class: 'muted' }, `${value}`));
  const actionBtn = (label, action, food) => el('button', {
    onclick: () => doAct(c.id, action, food),
  }, label);

  return el('div', { class: 'card' },
    el('div', { class: 'center' }, artNode(c)),
    el('h2', { class: 'center', style: 'margin:0' }, c.name),
    el('p', { class: 'center muted', style: 'margin:4px 0' },
      `${c.temperament} · ${c.stage} · gen ${c.generation}${c.parents ? ` · child of ${c.parents.join(' & ')}` : ''}`),
    el('p', { class: 'center muted', style: 'margin:0 0 4px' }, `${KIND_LABEL[c.genome.sex]} · ${HEART_LABEL[c.genome.attracts]}`),
    el('p', { class: 'center calls-you' }, c.you.nickname ? `Calls you “${c.you.nickname}”` : 'Does not have a name for you yet'),
    el('div', { class: 'bubble', id: 'bubble' }, state.lastLine || `${c.name} is ${c.mood}.`),
    el('div', { class: 'bars' },
      bar('Full', c.fullness), bar('Energy', c.energy), bar('Affection', c.affection),
      bar('Fondness', Math.max(0, c.you.fondness)), bar('Fear', c.you.fear)),
    el('div', { class: 'actions' },
      state.foods.map((f) => actionBtn(`🍽 ${f}`, 'feed', f)),
      actionBtn('🤗 Pet', 'pet'),
      actionBtn('🎾 Play', 'play'),
      actionBtn('👊 Bonk', 'hit'),
      actionBtn('🍃 Let be', 'let_be'),
    ),
    c.friends.length ? el('p', { class: 'muted' }, `Friends: ${c.friends.map((f) => `${f.name} (${f.affinity})`).join(', ')}`) : null,
    renderDiary(c),
  );
}

function renderDiary(c) {
  return [
    el('h4', {}, 'Diary (what they remember)'),
    c.diary.length
      ? el('ul', { class: 'diary' }, c.diary.slice().reverse().map((d) => el('li', {}, d.count > 1 ? `${d.text} (×${d.count})` : d.text)))
      : el('p', { class: 'muted' }, 'Nothing yet.'),
  ];
}

// A creature that wandered off: show its note and let people leave food.
function renderAway(c) {
  return el('div', { class: 'card' },
    el('div', { class: 'center away-art' }, artNode(c)),
    el('h2', { class: 'center', style: 'margin:0' }, `${c.name} has wandered off`),
    el('p', { class: 'center muted', style: 'margin:4px 0' }, c.away.reason === 'hungry' ? 'Left to find food.' : 'Ran away, scared.'),
    el('div', { class: 'bubble note' }, c.away.note),
    el('div', { class: 'bubble', id: 'bubble' }, state.lastLine || 'Leave something at the garden\'s edge. Only a favourite will tempt them.'),
    el('p', { class: 'muted' }, `Favourite snacks left so far: ${c.away.lures} of ${c.away.needed}`),
    el('div', { class: 'actions' },
      state.foods.map((f) => el('button', { onclick: () => doLure(c.id, f) }, `Leave ${f}`))),
    renderDiary(c),
  );
}

function renderIntroduce() {
  const home = state.creatures.filter((c) => !c.away);
  const select = (id) => el('select', { id }, home.map((c) => el('option', { value: c.id }, `${c.name} (${c.temperament})`)));
  const a = select('pair-a');
  const b = select('pair-b');
  if (home[1]) b.value = home[1].id;
  return el('div', {},
    el('h3', { style: 'margin-top:0' }, 'Play matchmaker'),
    el('p', { class: 'muted' }, 'Pick two creatures and see if they hit it off. Orientation is a hard limit; their feelings for you help.'),
    el('div', { class: 'row' }, a, el('span', {}, '💞'), b, el('button', { onclick: introduceSelected }, 'Introduce')),
    state.introResult ? el('div', { class: 'notice', style: 'margin-top:10px' }, state.introResult) : null,
  );
}

async function introduceSelected() {
  const a = document.getElementById('pair-a').value;
  const b = document.getElementById('pair-b').value;
  try {
    const data = await api('/api/introduce', { method: 'POST', body: { a, b } });
    state.introResult = data.lines.join(' ');
  } catch (err) {
    state.introResult = err.message;
  }
  await loadGarden();
}

async function doAct(id, action, food) {
  await sendAndRefresh(`/api/creatures/${id}/act`, { action, food });
}

async function doLure(id, food) {
  await sendAndRefresh(`/api/creatures/${id}/lure`, { food });
}

// Actions can change other creatures and the Gazette too (a runaway, a
// homecoming, a new nickname), so refresh the whole garden afterwards.
async function sendAndRefresh(path, body) {
  try {
    const data = await api(path, { method: 'POST', body });
    state.lastLine = data.line;
  } catch (err) {
    state.lastLine = err.message;
  }
  await loadGarden();
}

// ---- Owner: approve access --------------------------------------------------

async function loadAdmin() {
  const box = document.getElementById('admin');
  if (!box) return;
  const { requests, allowed } = await api('/api/admin/access');
  const decide = (email, decision) => async () => {
    await api(`/api/admin/access/${encodeURIComponent(email)}`, { method: 'POST', body: { decision } });
    loadAdmin();
  };
  const pending = Object.entries(requests);
  const approved = Object.entries(allowed);
  box.replaceChildren(
    el('h3', {}, 'Access requests (owner)'),
    pending.length
      ? el('table', { class: 'table' }, pending.map(([email, r]) => el('tr', {},
          el('td', {}, `${r.name} <${email}>`),
          el('td', {}, el('button', { onclick: decide(email, 'approve') }, 'Approve'), ' ',
            el('button', { class: 'ghost', onclick: decide(email, 'deny') }, 'Deny'))))) 
      : el('p', { class: 'muted' }, 'No pending requests.'),
    el('h4', {}, 'Approved'),
    approved.length
      ? el('table', { class: 'table' }, approved.map(([email, a]) => el('tr', {},
          el('td', {}, `${a.name} <${email}>`),
          el('td', {}, el('button', { class: 'ghost', onclick: decide(email, 'revoke') }, 'Revoke')))))
      : el('p', { class: 'muted' }, 'Nobody else yet.'),
  );
}

// ---- Boot -------------------------------------------------------------------

async function boot() {
  const params = new URLSearchParams(location.search);
  try {
    state.me = await api('/api/me');
  } catch {
    return renderLogin(params.has('denied') ? 'Sign-in did not complete. Try again.' : null);
  }
  who.textContent = `${state.me.name} · ${state.me.access}`;
  if (state.me.access === 'pending') return renderPending(state.me);
  await loadGarden();
  setInterval(() => { if (!document.hidden) loadGarden().catch(() => {}); }, 30000);
}

boot().catch((err) => {
  app.replaceChildren(el('p', { class: 'error' }, `Something went wrong: ${err.message}`));
});
