import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newCreature, act, tick, lure, introduce, greet, HOUR_MS, WANDER } from '../src/sim.js';
import { nicknameFor } from '../src/nicknames.js';
import { gazette } from '../src/gazette.js';

const NOW = Date.UTC(2030, 0, 1);
const constant = (v) => () => v;
// Trait overrides (e.g. { appetite: 0 }) go into genome.traits; the rest are top-level genes.
const TRAITS = ['curiosity', 'charm', 'sturdiness', 'appetite'];
const genome = (over = {}) => {
  const traits = { curiosity: 0.5, charm: 0.5, sturdiness: 0.5, appetite: 0.5 };
  const genes = {};
  for (const [key, value] of Object.entries(over)) (TRAITS.includes(key) ? traits : genes)[key] = value;
  return { hue: 200, shape: 'round', ears: 'round', sex: 'a', attracts: 'b', temperament: 'sweet', ...genes, traits };
};
const adult = (over) => {
  const c = newCreature({ genome: genome(over), now: NOW - 100 * HOUR_MS, rng: constant(0.5) });
  c.lastTick = NOW;
  c.lastStage = 'adult';
  return c;
};
const opts = (extra = {}) => ({ now: NOW, rng: constant(0.9), actorName: 'Angela', ...extra });

// ---- Nicknames ----------------------------------------------------------------

test('feeding favourites earns a nickname, announced once', () => {
  const c = adult({ temperament: 'sweet' }); // likes berries
  let announced = 0;
  for (let i = 0; i < 4; i++) {
    c.fullness = 10;
    const { line } = act(c, 'me', 'feed', opts({ food: 'berry' }));
    if (line.includes('"')) announced++;
  }
  assert.ok(c.people.me.nickname, 'expected a nickname');
  assert.ok(announced >= 1 && announced <= 2, `nickname announced ${announced} times`);
});

test('bonkers get an unkind nickname, flavoured by temperament', () => {
  const sweet = adult({ temperament: 'sweet', sturdiness: 1 });
  sweet.people.me = { fondness: -10, fear: 0, memories: [{ type: 'hit' }, { type: 'hit' }, { type: 'hit' }] };
  assert.equal(nicknameFor(sweet, sweet.people.me).name, 'Rough-Hands');
  const grumpy = adult({ temperament: 'grumpy' });
  grumpy.people.me = { fondness: -30, fear: 10, memories: [{ type: 'hit' }, { type: 'hit' }, { type: 'hit' }] };
  assert.equal(nicknameFor(grumpy, grumpy.people.me).name, 'The Bonker');
  assert.equal(nicknameFor(grumpy, grumpy.people.me).negative, true);
});

test('greetings use the nickname', () => {
  const c = adult({ temperament: 'sweet' });
  c.people.me = { fondness: 50, fear: 0, memories: [{ type: 'pet' }], nickname: 'Cuddle Buddy' };
  assert.match(greet(c, 'me', NOW, constant(0.9)), /^Cuddle Buddy! /);
});

// ---- Wandering off and coming home ---------------------------------------------

test('a creature left hungry for long enough wanders off, timed from when it got hungry', () => {
  const c = adult({ appetite: 0 }); // loses 2 fullness an hour
  c.fullness = 25; // hungry after 10 hours, gone 8 hours later
  assert.deepEqual(tick(c, NOW + 17 * HOUR_MS), []);
  const events = tick(c, NOW + 19 * HOUR_MS);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'wandered_off');
  assert.equal(events[0].at, NOW + 18 * HOUR_MS);
  assert.equal(c.away.reason, 'hungry');
});

test('feeding a hungry creature in time keeps it home', () => {
  const c = adult({ appetite: 0, temperament: 'sweet' });
  c.fullness = 25;
  tick(c, NOW + 15 * HOUR_MS);
  act(c, 'me', 'feed', opts({ food: 'berry', now: NOW + 15 * HOUR_MS }));
  assert.deepEqual(tick(c, NOW + 20 * HOUR_MS), []);
  assert.equal(c.away, null);
});

test('enough bonks make a creature run away, and actions stop working', () => {
  const c = adult({ temperament: 'shy', sturdiness: 0 }); // shy: bonks hurt more
  let result;
  for (let i = 0; i < 5 && !c.away; i++) result = act(c, 'bully', 'hit', opts());
  assert.equal(result.situation, 'ran_away');
  assert.equal(c.away.reason, 'scared');
  assert.ok(result.events.some((e) => e.type === 'wandered_off'));
  assert.throws(() => act(c, 'friend', 'pet', opts()), /not in the garden/);
});

test('only a favourite food lures a creature home, and the bully cannot', () => {
  const c = adult({ temperament: 'shy', sturdiness: 0 }); // shy likes berries and fish
  while (!c.away) act(c, 'bully', 'hit', opts());
  assert.equal(lure(c, 'bully', 'berry', opts()).cameHome, false);
  assert.equal(c.away.lures, 0, 'the bully’s snack does not count');
  assert.equal(lure(c, 'friend', 'pepper', opts()).cameHome, false);
  assert.equal(c.away.lures, 0, 'a non-favourite does not count');
  lure(c, 'friend', 'berry', opts());
  lure(c, 'friend', 'fish', opts());
  const last = lure(c, 'other', 'berry', opts({ actorName: 'Sam' }));
  assert.equal(last.cameHome, true);
  assert.equal(c.away, null);
  assert.deepEqual(last.events.find((e) => e.type === 'came_home').users, ['Angela', 'Sam']);
  assert.ok(c.people.friend.memories.some((m) => m.type === 'rescued'));
  assert.ok(c.people.bully.fear >= 50, 'comes home wary of whoever drove it away');
});

test('the bully can help once the creature has calmed down', () => {
  const c = adult({ temperament: 'sweet', sturdiness: 0 });
  while (!c.away) act(c, 'bully', 'hit', opts());
  tick(c, NOW + 48 * HOUR_MS); // fear fades while away
  assert.ok(c.people.bully.fear < WANDER.blamedFearLimit);
  lure(c, 'bully', 'berry', opts({ now: NOW + 48 * HOUR_MS }));
  assert.equal(c.away.lures, 1);
});

test('creatures that are away cannot be introduced', () => {
  const a = adult({ sex: 'a', attracts: 'b' });
  const b = adult({ sex: 'b', attracts: 'a' });
  b.away = { reason: 'hungry', lures: 0, helpers: [] };
  assert.throws(() => introduce(a, b, 'me', NOW, constant(0)), /not in the garden/);
});

// ---- Gazette -------------------------------------------------------------------

const byId = { p: { name: 'Pipni' }, l: { name: 'Lonife' }, m: { name: 'Mibo' }, k: { name: 'Kid' } };

test('the Gazette leads with babies and calls out scandals', () => {
  const events = [
    { at: NOW - 5000, type: 'date', creature: 'p', other: 'l', user: 'Angela' },
    { at: NOW - 3000, type: 'date', creature: 'p', other: 'm', user: 'Sam' },
    { at: NOW - 1000, type: 'baby', creature: 'k', parents: ['p', 'm'] },
  ];
  const headlines = gazette(events, byId, { now: NOW });
  assert.match(headlines[0].text, /BIG NEWS: Pipni and Mibo welcomed baby Kid/);
  assert.ok(headlines.some((h) => /SCANDAL: Pipni was seen on a date with Mibo\. Does Lonife know\?/.test(h.text)));
  assert.ok(headlines.some((h) => /LOVE IS IN THE AIR: Pipni and Lonife/.test(h.text)));
});

test('bonks are grouped and never name the bonker', () => {
  const events = [1, 2, 3].map((i) => ({ at: NOW - i, type: 'bonk', creature: 'p' }));
  events.push({ at: NOW, type: 'nickname', creature: 'p', user: null, detail: 'The Bonker', negative: true });
  events.push({ at: NOW - 10, type: 'nickname', creature: 'p', subject: 'bully', user: null, detail: 'Scary One', negative: true });
  events[3].subject = 'bully';
  const text = gazette(events, byId, { now: NOW }).map((h) => h.text).join('\n');
  assert.doesNotMatch(text, /Scary One/, 'only the latest anonymous nickname shows');
  assert.doesNotMatch(text, /bully/, 'the subject is never shown');
  assert.match(text, /WHODUNNIT: Someone keeps bonking Pipni \(3 times\)/);
  assert.match(text, /a new name for someone: "The Bonker"/);
});

test('superseded news is dropped: older nicknames, and missing notices after a homecoming', () => {
  const events = [
    { at: NOW - 400, type: 'nickname', creature: 'p', user: 'Angela', detail: 'New Friend' },
    { at: NOW - 300, type: 'wandered_off', creature: 'p', detail: 'scared' },
    { at: NOW - 200, type: 'came_home', creature: 'p', users: ['Angela'], detail: 'scared' },
    { at: NOW - 100, type: 'nickname', creature: 'p', user: 'Angela', detail: 'My Hero' },
  ];
  const text = gazette(events, byId, { now: NOW }).map((h) => h.text).join('\n');
  assert.match(text, /"My Hero"/);
  assert.doesNotMatch(text, /New Friend/);
  assert.doesNotMatch(text, /RUNAWAY/);
  assert.match(text, /HOMECOMING: Pipni is back, thanks to Angela/);
});

test('headlines are marked new since the last visit, and old news drops off', () => {
  const events = [
    { at: NOW - 3 * 24 * HOUR_MS, type: 'grew_up', creature: 'k', detail: 'adult' },
    { at: NOW - 2 * HOUR_MS, type: 'grew_up', creature: 'p', detail: 'youth' },
    { at: NOW - 1 * HOUR_MS, type: 'not_type', creature: 'p', other: 'l', user: 'Angela' },
  ];
  const headlines = gazette(events, byId, { now: NOW, lastSeen: NOW - 90 * 60 * 1000 });
  assert.equal(headlines.length, 2);
  assert.deepEqual(headlines.map((h) => h.isNew).sort(), [false, true]);
  assert.match(gazette([], byId, { now: NOW })[0].text, /quiet day/i);
});

test('repeated diary entries are counted, not listed again', () => {
  const c = adult({ temperament: 'bold', sturdiness: 1 });
  for (let i = 0; i < 3; i++) act(c, 'me', 'hit', opts());
  const bonks = c.diary.filter((d) => d.text.startsWith('Someone bonked me'));
  assert.equal(bonks.length, 1);
  assert.equal(bonks[0].count, 3);
});
