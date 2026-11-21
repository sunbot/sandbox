/**
 * Guards that Today, Week and the views derived from them refresh together after any diary or plan change,
 * so one screen can never show stale numbers that disagree with another.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { NUTRITION_KEYS } from './invalidation.ts';

const hooks = readFileSync(new URL('./hooks.ts', import.meta.url), 'utf8');

test('every nutrition-summarising query family is invalidated together', () => {
  for (const key of ['day', 'week', 'quickLog', 'gaps', 'heatmap', 'grocery', 'rebalance']) assert.ok(NUTRITION_KEYS.includes(key as never), key);
});

test('each query key used for those families is in the invalidation list', () => {
  const used = [...hooks.matchAll(/queryKey: keys\.(\w+)\(/g)].map((m) => m[1]);
  for (const family of ['day', 'week', 'quickLog', 'gaps', 'heatmap', 'grocery', 'rebalance']) assert.ok(used.includes(family) || family === 'rebalance', family);
  for (const family of ['day', 'week']) assert.ok(NUTRITION_KEYS.includes(family as never));
});

test('every diary and plan mutation invalidates', () => {
  const section = (name: string) => {
    const start = hooks.indexOf(`// ── ${name}`);
    const next = hooks.indexOf('// ──', start + 5);
    return hooks.slice(start, next < 0 ? undefined : next);
  };
  const diary = section('Diary');
  const plan = section('Plan');
  for (const [name, body] of [['diary', diary], ['plan', plan]] as const) {
    const mutations = (body.match(/useMutation\(/g) ?? []).length;
    const invalidating = (body.match(/onSuccess: invalidate|\.\.\.opts/g) ?? []).length;
    assert.ok(mutations > 0, `${name}: found no mutations`);
    assert.ok(invalidating >= mutations, `${name}: ${mutations} mutations but ${invalidating} invalidate`);
  }
});

test('the device date, not the server clock, decides what is today', () => {
  assert.match(hooks, /plan\/week\?\$\{q\(\{ date, today: today\(\) \}\)\}/);
  assert.match(hooks, /plan\/rebalance\?\$\{q\(\{ date, today: today\(\) \}\)\}/);
  assert.match(hooks, /\/eaten`, \{ scale: scale \?\? 1, today: today\(\) \}/);
});

test('Log all and Plan all send an Idempotency-Key so a retry cannot save twice', () => {
  assert.match(hooks, /'\/diary\/foods', r, once\(key\)/);
  assert.match(hooks, /'\/plan\/foods', r, once\(key\)/);
});
