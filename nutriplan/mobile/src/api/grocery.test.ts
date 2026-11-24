import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeGrocery } from './grocery.ts';

test('payload without hiddenItems (older API) defaults to an empty array', () => {
  const g = normalizeGrocery({ from: 'a', to: 'b', itemCount: 1, aisles: [{ aisle: 'Produce', items: [{ name: 'Apple', display: '1', inPantry: false }] }] });
  assert.deepEqual(g.hiddenItems, []);
  assert.deepEqual(g.aisles[0].items[0].usedIn, []);
  assert.deepEqual(g.aisles[0].items[0].unconvertedAmounts, []);
  assert.equal(g.aisles[0].items[0].key, 'apple');
});

test('malformed payloads never throw', () => {
  for (const bad of [null, undefined, 5, 'x', {}, { aisles: 3, hiddenItems: {} }, { aisles: [null, { items: [null] }] }]) {
    const g = normalizeGrocery(bad);
    assert.ok(Array.isArray(g.aisles) && Array.isArray(g.hiddenItems));
  }
});

test('a complete payload is preserved', () => {
  const item = { name: 'Rice', display: '200 g', inPantry: false, usedIn: ['Bowl'], unconvertedAmounts: ['1 pinch'], key: 'k1' };
  const g = normalizeGrocery({ from: 'a', to: 'b', itemCount: 1, aisles: [{ aisle: 'Pantry', items: [item] }], hiddenItems: [item] });
  assert.equal(g.aisles[0].items[0].key, 'k1');
  assert.equal(g.hiddenItems.length, 1);
});
