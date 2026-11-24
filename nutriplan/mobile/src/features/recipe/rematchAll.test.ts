import assert from 'node:assert/strict';
import { test } from 'node:test';
import { kcalChange, lineChange } from './rematchAll.ts';

test('a changed line reads as before → after, with grams, and says when a line has no food', () => {
  assert.equal(lineChange({ rawText: '1 can coconut milk', foodBefore: 'Coconut milk', foodAfter: 'Nuts, coconut milk, canned', gramsBefore: 382.7, gramsAfter: 382.7, status: 'AutoMatched' }),
    'Coconut milk (383 g) → Nuts, coconut milk, canned (383 g)');
  assert.equal(lineChange({ rawText: 'x', foodBefore: 'Coconut milk', foodAfter: null, status: 'Unmatched' }), 'Coconut milk → not matched');
  assert.equal(lineChange({ rawText: 'x', foodBefore: null, foodAfter: 'Lentils', gramsAfter: 192, status: 'AutoMatched' }), 'not matched → Lentils (192 g)');
});

test('calories per serving before and after', () => {
  assert.equal(kcalChange({ kcalPerServingBefore: 388.4, kcalPerServingAfter: 504 }), '388 → 504 kcal per serving');
  assert.equal(kcalChange({ kcalPerServingBefore: 200, kcalPerServingAfter: 200.2 }), '200 kcal per serving (unchanged)');
});
