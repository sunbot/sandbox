// Creature Garden front end. Plain DOM, no build step. User-supplied text is
// always set with textContent; the SVG only uses numbers and fixed strings.

const app = document.getElementById('app');
const who = document.getElementById('who');
const state = { me: null, creatures: [], foods: [], selectedId: null, lastLine: '' };

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
// Simple round blobs whose shape, colour, ears and eyes come from the genome.
// Mood changes the mouth; fondness adds blush. Babies are smaller.

const SVG_NS = 'http://www.w3.org/2000/svg';

function creatureSVG(c) {
  const g = c.genome;
  const hue = g.hue;
  const fill = `hsl(${hue} 70% 80%)`;
  const stroke = `hsl(${hue} 45% 45%)`;
  const scale = { baby: 0.72, youth: 0.86, adult: 1 }[c.stage] ?? 1;
  const eyeR = 6 + g.traits.curiosity * 3;
  const cx = 100;
  const cy = 118;

  let body;
  if (g.shape === 'tall') body = `<ellipse cx="${cx}" cy="${cy}" rx="46" ry="58" fill="${fill}" stroke="${stroke}" stroke-width="3"/>`;
  else if (g.shape === 'fluffy') {
    body = [[-38, 10], [38, 10], [-22, -34], [22, -34], [0, -46], [-42, -18], [42, -18]]
      .map(([dx, dy]) => `<circle cx="${cx + dx}" cy="${cy + dy}" r="26" fill="${fill}"/>`)
      .join('') + `<circle cx="${cx}" cy="${cy}" r="58" fill="${fill}" stroke="${stroke}" stroke-width="3"/>`;
  } else body = `<circle cx="${cx}" cy="${cy}" r="56" fill="${fill}" stroke="${stroke}" stroke-width="3"/>`;

  const earY = cy - 50;
  const ears = {
    none: '',
    round: `<circle cx="${cx - 38}" cy="${earY}" r="14" fill="${fill}" stroke="${stroke}" stroke-width="3"/><circle cx="${cx + 38}" cy="${earY}" r="14" fill="${fill}" stroke="${stroke}" stroke-width="3"/>`,
    pointy: `<path d="M${cx - 44} ${earY + 10} L${cx - 30} ${earY - 34} L${cx - 14} ${earY + 4} Z" fill="${fill}" stroke="${stroke}" stroke-width="3" stroke-linejoin="round"/><path d="M${cx + 44} ${earY + 10} L${cx + 30} ${earY - 34} L${cx + 14} ${earY + 4} Z" fill="${fill}" stroke="${stroke}" stroke-width="3" stroke-linejoin="round"/>`,
    leaf: `<ellipse cx="${cx - 36}" cy="${earY - 6}" rx="10" ry="24" transform="rotate(-25 ${cx - 36} ${earY - 6})" fill="hsl(${(hue + 40) % 360} 60% 70%)" stroke="${stroke}" stroke-width="3"/><ellipse cx="${cx + 36}" cy="${earY - 6}" rx="10" ry="24" transform="rotate(25 ${cx + 36} ${earY - 6})" fill="hsl(${(hue + 40) % 360} 60% 70%)" stroke="${stroke}" stroke-width="3"/>`,
  }[g.ears] ?? '';

  const eyeY = cy - 6;
  const eyes = [cx - 20, cx + 20].map((x) => `
    <circle cx="${x}" cy="${eyeY}" r="${eyeR}" fill="#3d3350"/>
    <circle cx="${x + 2}" cy="${eyeY - 2}" r="${eyeR * 0.35}" fill="#fff"/>`).join('');

  const scared = c.mood === 'scared';
  const brows = c.mood === 'scared' || c.mood === 'hungry'
    ? `<path d="M${cx - 30} ${eyeY - 14} L${cx - 12} ${eyeY - 8}" stroke="#3d3350" stroke-width="2.5" stroke-linecap="round"/><path d="M${cx + 30} ${eyeY - 14} L${cx + 12} ${eyeY - 8}" stroke="#3d3350" stroke-width="2.5" stroke-linecap="round"/>`
    : '';
  const mouths = {
    happy: `<path d="M${cx - 12} ${cy + 16} Q${cx} ${cy + 30} ${cx + 12} ${cy + 16}" fill="none" stroke="#3d3350" stroke-width="3" stroke-linecap="round"/>`,
    content: `<path d="M${cx - 9} ${cy + 18} Q${cx} ${cy + 23} ${cx + 9} ${cy + 18}" fill="none" stroke="#3d3350" stroke-width="3" stroke-linecap="round"/>`,
    hungry: `<ellipse cx="${cx}" cy="${cy + 20}" rx="6" ry="7" fill="#3d3350"/>`,
    tired: `<path d="M${cx - 9} ${cy + 20} L${cx + 9} ${cy + 20}" stroke="#3d3350" stroke-width="3" stroke-linecap="round"/>`,
    scared: `<ellipse cx="${cx}" cy="${cy + 20}" rx="5" ry="8" fill="#3d3350"/>`,
  }[c.mood] ?? '';
  const sweat = scared ? `<path d="M${cx + 52} ${cy - 30} q6 12 0 18 q-6 -6 0 -18z" fill="#9fd8ff"/>` : '';

  const blush = c.you.fondness > 40
    ? `<ellipse cx="${cx - 34}" cy="${cy + 10}" rx="7" ry="4" fill="#ff8fb1" opacity="0.7"/><ellipse cx="${cx + 34}" cy="${cy + 10}" rx="7" ry="4" fill="#ff8fb1" opacity="0.7"/>`
    : '';

  return `<svg class="creature-art bob" viewBox="0 0 200 200" role="img" aria-label="${c.stage} ${c.mood} creature" style="transform-origin:center">
    <g transform="translate(${cx} ${cy}) scale(${scale}) translate(${-cx} ${-cy})">
      ${ears}${body}${brows}${eyes}${blush}${mouths}${sweat}
    </g></svg>`;
}

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
  const data = await api('/api/garden');
  state.creatures = data.creatures;
  state.foods = data.foods;
  if (!state.selectedId && state.creatures.length) state.selectedId = state.creatures[0].id;
  renderGarden();
}

function renderGarden() {
  const selected = state.creatures.find((c) => c.id === state.selectedId);
  const grid = el('div', { class: 'garden' }, state.creatures.map((c) =>
    el('div', {
      class: `critter${c.id === state.selectedId ? ' selected' : ''}`,
      role: 'button',
      tabindex: 0,
      onclick: () => { state.selectedId = c.id; state.lastLine = ''; renderGarden(); },
    },
    artNode(c),
    el('div', { class: 'name' }, c.name),
    el('div', { class: 'sub' }, `${c.temperament} · ${c.stage}`),
    )));

  app.replaceChildren(
    el('div', { class: 'stage' },
      el('div', {},
        el('div', { class: 'card' }, grid),
        el('div', { class: 'card' }, renderIntroduce()),
      ),
      el('div', {}, selected ? renderCreature(selected) : el('p', { class: 'muted' }, 'No creatures yet.'),
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
    el('h4', {}, 'Diary (what they remember)'),
    c.diary.length
      ? el('ul', { class: 'diary' }, c.diary.slice().reverse().map((d) => el('li', {}, d.text)))
      : el('p', { class: 'muted' }, 'Nothing yet.'),
  );
}

function renderIntroduce() {
  const select = (id) => el('select', { id }, state.creatures.map((c) => el('option', { value: c.id }, `${c.name} (${c.temperament})`)));
  const a = select('pair-a');
  const b = select('pair-b');
  if (state.creatures[1]) b.value = state.creatures[1].id;
  return el('div', {},
    el('h3', { style: 'margin-top:0' }, 'Play matchmaker'),
    el('p', { class: 'muted' }, 'Pick two creatures and see if they hit it off. Orientation is a hard limit; their feelings for you help.'),
    el('div', { class: 'row' }, a, el('span', {}, '💞'), b, el('button', { onclick: introduceSelected }, 'Introduce')),
    el('div', { id: 'intro-result', class: 'notice', style: 'margin-top:10px;display:none' }),
  );
}

async function introduceSelected() {
  const a = document.getElementById('pair-a').value;
  const b = document.getElementById('pair-b').value;
  const out = document.getElementById('intro-result');
  try {
    const data = await api('/api/introduce', { method: 'POST', body: { a, b } });
    out.style.display = 'block';
    out.textContent = data.lines.join(' ');
    await loadGarden();
  } catch (err) {
    out.style.display = 'block';
    out.textContent = err.message;
  }
}

async function doAct(id, action, food) {
  try {
    const data = await api(`/api/creatures/${id}/act`, { method: 'POST', body: { action, food } });
    state.lastLine = data.line;
    state.creatures = state.creatures.map((c) => (c.id === id ? data.creature : c));
    renderGarden();
  } catch (err) {
    state.lastLine = err.message;
    renderGarden();
  }
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
