import { test } from 'node:test';
import assert from 'node:assert/strict';
import { breed, attractionMatch, randomGenome } from '../src/genetics.js';
import { newCreature, act, advance, introduce, mate, canMate, viewFor, HOUR_MS } from '../src/sim.js';
import { speak } from '../src/dialogue.js';
import { accessFor, decide, requestAccess } from '../src/auth.js';

const NOW = Date.UTC(2030, 0, 1);
const constant = (v) => () => v;
const sequence = (...vals) => { let i = 0; return () => vals[i++ % vals.length]; };
// Trait overrides (e.g. { appetite: 0 }) go into genome.traits; the rest are top-level genes.
const TRAITS = ['curiosity', 'charm', 'sturdiness', 'appetite'];
const genome = (over = {}) => {
  const traits = { curiosity: 0.5, charm: 0.5, sturdiness: 0.5, appetite: 0.5 };
  const genes = {};
  for (const [key, value] of Object.entries(over)) (TRAITS.includes(key) ? traits : genes)[key] = value;
  return { hue: 200, shape: 'round', ears: 'round', sex: 'a', attracts: 'b', temperament: 'sweet', ...genes, traits };
};
const adult = (over, now = NOW) => newCreature({ genome: genome(over), now: now - 100 * HOUR_MS, rng: constant(0.5) });

test('breeding keeps traits in range and parents set the body plan', () => {
  const a = randomGenome(constant(0.1));
  const b = randomGenome(constant(0.9));
  for (let i = 0; i < 50; i++) {
    const child = breed(a, b, Math.random);
    assert.ok(child.hue >= 0 && child.hue < 360);
    for (const v of Object.values(child.traits)) assert.ok(v >= 0 && v <= 1);
    assert.ok([a.shape, b.shape].includes(child.shape));
    assert.ok(['a', 'b'].includes(child.sex));
  }
});

test('attraction is mutual and asexual creatures never match', () => {
  assert.equal(attractionMatch(genome({ sex: 'a', attracts: 'b' }), genome({ sex: 'b', attracts: 'a' })), true);
  assert.equal(attractionMatch(genome({ sex: 'a', attracts: 'b' }), genome({ sex: 'a', attracts: 'a' })), false);
  assert.equal(attractionMatch(genome({ sex: 'a', attracts: 'both' }), genome({ sex: 'a', attracts: 'a' })), true);
  assert.equal(attractionMatch(genome({ sex: 'a', attracts: 'none' }), genome({ sex: 'b', attracts: 'both' })), false);
});

test('feeding a favourite raises fondness, feeding a disliked food does less', () => {
  const liked = adult({ temperament: 'sweet' }); // sweet likes berries
  act(liked, 'me@x.com', 'feed', { food: 'berry', now: NOW, rng: constant(0.5) });
  const disliked = adult({ temperament: 'sweet' });
  act(disliked, 'me@x.com', 'feed', { food: 'pepper', now: NOW, rng: constant(0.5) });
  assert.ok(liked.people['me@x.com'].fondness > disliked.people['me@x.com'].fondness);
});

test('bonking lowers fondness, raises fear, and is remembered', () => {
  const c = adult({ temperament: 'grumpy' });
  const { situation } = act(c, 'me@x.com', 'hit', { now: NOW, rng: constant(0.9) });
  const p = c.people['me@x.com'];
  assert.equal(situation, 'hit');
  assert.ok(p.fondness < 0);
  assert.ok(p.fear > 0);
  assert.equal(p.memories.at(-1).type, 'hit');
});

test('repeated bonks escalate to a sharper reaction', () => {
  const c = adult({ temperament: 'sweet' });
  act(c, 'me@x.com', 'hit', { now: NOW, rng: constant(0.9) });
  act(c, 'me@x.com', 'hit', { now: NOW, rng: constant(0.9) });
  const { situation } = act(c, 'me@x.com', 'hit', { now: NOW, rng: constant(0.9) });
  assert.equal(situation, 'hit_repeat');
});

test('a creature remembers a bonk and mentions it later', () => {
  const c = adult({ temperament: 'sweet' });
  act(c, 'me@x.com', 'hit', { now: NOW, rng: constant(0.9) });
  // rng 0 always takes the callback branch and picks the first option.
  const line = speak(c, 'pet', { memories: c.people['me@x.com'].memories, rng: constant(0) });
  assert.match(line, /hit me|still have not forgotten|wary|forgive/);
});

test('memories are per user: one person bonking does not sour another', () => {
  const c = adult({ temperament: 'sweet' });
  act(c, 'bully@x.com', 'hit', { now: NOW, rng: constant(0.9) });
  act(c, 'kind@x.com', 'pet', { now: NOW, rng: constant(0.5) });
  assert.ok(c.people['kind@x.com'].fondness > 0);
  assert.equal(c.people['kind@x.com'].memories.filter((m) => m.type === 'hit').length, 0);
  assert.ok(c.people['bully@x.com'].fondness < 0);
});

test('needs decay with time but never past the limits', () => {
  const c = adult({ appetite: 1 });
  c.fullness = 80;
  advance(c, NOW + 10 * HOUR_MS);
  assert.ok(c.fullness < 80 && c.fullness >= 0);
  advance(c, NOW + 10000 * HOUR_MS);
  assert.ok(c.fullness >= 0 && c.energy <= 100);
});

test('introducing incompatible creatures is refused by orientation, not luck', () => {
  const a = adult({ sex: 'a', attracts: 'b' });
  const b = adult({ sex: 'a', attracts: 'a' });
  const result = introduce(a, b, 'me@x.com', NOW, constant(0));
  assert.equal(result.outcome, 'not_type');
  assert.equal(result.baby, undefined);
});

test('a successful date between compatible adults can produce a child', () => {
  const a = adult({ sex: 'a', attracts: 'b', temperament: 'bold' });
  const b = adult({ sex: 'b', attracts: 'a', temperament: 'bold' });
  a.friends[b.id] = { affinity: 40, memories: [] };
  b.friends[a.id] = { affinity: 40, memories: [] };
  a.people['me@x.com'] = { fondness: 80, fear: 0, memories: [] };
  b.people['me@x.com'] = { fondness: 80, fear: 0, memories: [] };
  const result = introduce(a, b, 'me@x.com', NOW, constant(0));
  assert.equal(result.outcome, 'date_yes');
  assert.ok(result.baby, 'expected a baby once bonded');
  assert.deepEqual(result.baby.parents, [a.id, b.id]);
  assert.equal(result.baby.generation, 1);
});

test('mating needs adults, energy and bond', () => {
  const young = newCreature({ genome: genome({ sex: 'a', attracts: 'b' }), now: NOW, rng: constant(0.5) });
  const other = adult({ sex: 'b', attracts: 'a' });
  assert.equal(canMate(young, other, NOW), false);
  assert.equal(mate(young, other, NOW, constant(0.5)), null);
});

test('the owner can view everything about their own relationship only', () => {
  const c = adult({ temperament: 'shy' });
  act(c, 'me@x.com', 'pet', { now: NOW, rng: constant(0.5) });
  const mine = viewFor(c, 'me@x.com', NOW);
  const theirs = viewFor(c, 'other@x.com', NOW);
  assert.ok(mine.you.fondness > 0);
  assert.equal(theirs.you.fondness, 0);
  assert.equal(theirs.diary.length, 0);
});

test('access: owner is always in, approved people are in, others wait for approval', () => {
  const store = { data: { allowed: {}, requests: {} }, save() {} };
  const owner = 'moyler.angela@gmail.com';
  assert.equal(accessFor(owner, store, owner), 'owner');
  assert.equal(accessFor('friend@x.com', store, owner), 'none');
  requestAccess('friend@x.com', 'Friend', store);
  assert.equal(accessFor('friend@x.com', store, owner), 'pending');
  decide('friend@x.com', 'approve', store, owner);
  assert.equal(accessFor('friend@x.com', store, owner), 'approved');
  decide('friend@x.com', 'revoke', store, owner);
  assert.equal(accessFor('friend@x.com', store, owner), 'none');
});
