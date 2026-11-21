/**
 * Tests for Ask's multi-food review draft. Run with `npm test` (Node's built-in test runner; no extra dependencies).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FoodMatch, FoodMatchGroup } from '../../api/types';
import { amountOptions, blockers, draftFrom, needsLook, preview, replaceItem, selectMatch, setAmount, setRemoved, toRequest, totals, withPickedFood } from './draft.ts';

const per100 = (calories: number, protein = 0, carbs = 0, fat = 0) => ({ calories, protein, carbs, fat, fiber: 0, nutrients: {} });

function match(id: string, name: string, per100g: ReturnType<typeof per100>, quantity: FoodMatch['quantity'], confidence = 0.9, portions = [] as { description: string; grams: number }[]): FoodMatch {
  return { food: { id, name, source: 'UsdaSurvey', quality: 'Standard', per100g, portions }, score: 60, quantity, confidence, nutrition: null };
}

const eggs: FoodMatchGroup = {
  text: '2 eggs', amount: 2, unit: null, foodQuery: 'eggs',
  matches: [
    match('egg', 'Egg, whole, raw, fresh', per100(143, 12.6, 0.7, 9.5), { grams: 100, method: 'DefaultPortion', explanation: '2 × large (50 g each)', status: 'Given' }, 0.95, [{ description: 'large', grams: 50 }]),
    match('egg-boiled', 'Egg, whole, cooked, hard-boiled', per100(155, 12.6, 1.1, 10.6), { grams: 100, method: 'DefaultPortion', explanation: '2 × large (50 g each)', status: 'Given' }, 0.7),
  ],
};
const toast: FoodMatchGroup = {
  text: 'toast', amount: null, unit: null, foodQuery: 'toast',
  matches: [match('toast', 'Bread, white, toasted', per100(293, 9, 54, 4), { grams: 25, method: 'DefaultPortion', explanation: '1 × slice (25 g each)', status: 'Assumed' }, 0.8, [{ description: 'slice', grams: 25 }])],
};
const granola: FoodMatchGroup = {
  text: 'granola', amount: null, unit: null, foodQuery: 'granola',
  matches: [match('granola', 'Granola', per100(471, 10, 64, 20), { grams: null, method: 'Unresolved', explanation: 'No amount given. Choose how much.', status: 'NeedsAmount' }, 0.4)],
};
const nothing: FoodMatchGroup = { text: 'zzz', amount: null, unit: null, foodQuery: 'zzz', matches: [] };

test('one draft item per food, starting on the best match', () => {
  const items = draftFrom([eggs, toast]);
  assert.equal(items.length, 2);
  assert.equal(items[0].amountLabel, '2 large');
  assert.equal(items[1].amountLabel, '1 slice');
  assert.equal(items[1].status, 'Assumed');
});

test('combined totals add every included food', () => {
  const items = draftFrom([eggs, toast]);
  const t = totals(items);
  assert.equal(Math.round(t.calories), 143 + 73);
  assert.equal(Math.round(t.protein * 10) / 10, 14.9); // 12.6 + 2.25
});

test('removing a food drops it from totals and from the request', () => {
  let items = draftFrom([eggs, toast]);
  items = replaceItem(items, setRemoved(items[1], true));
  assert.equal(Math.round(totals(items).calories), 143);
  assert.deepEqual(toRequest(items), [{ foodId: 'egg', grams: 100 }]);
});

test('changing one match keeps the other foods as they were', () => {
  let items = draftFrom([eggs, toast]);
  const edited = setAmount(items[1], 2, { label: 'slice', grams: 25 });
  items = replaceItem(items, edited);
  items = replaceItem(items, selectMatch(items[0], 1));
  assert.equal(items[0].matchIndex, 1);
  assert.equal(items[1].grams, 50);
  assert.equal(items[1].amountLabel, '2 slice');
});

test('switching match uses that food’s own conversion unless you set the amount yourself', () => {
  const [item] = draftFrom([eggs]);
  assert.equal(selectMatch(item, 1).grams, 100);
  const mine = setAmount(item, 120, { label: 'g', grams: 1 });
  const switched = selectMatch(mine, 1);
  assert.equal(switched.grams, 120);
  assert.equal(switched.status, 'Edited');
});

test('a food without an amount, or without a match, blocks Log all', () => {
  const items = draftFrom([eggs, granola, nothing]);
  assert.deepEqual(blockers(items).map((i) => i.group.text), ['granola', 'zzz']);
  assert.throws(() => toRequest(items), /need a match or an amount/);
  assert.equal(preview(items[1]), null); // no grams → no made-up nutrition
});

test('blocked foods can be fixed or removed', () => {
  let items = draftFrom([eggs, granola, nothing]);
  items = replaceItem(items, setAmount(items[1], 0.5, { label: 'cup', grams: 122 }));
  items = replaceItem(items, setRemoved(items[2], true));
  assert.deepEqual(blockers(items), []);
  assert.deepEqual(toRequest(items), [{ foodId: 'egg', grams: 100 }, { foodId: 'granola', grams: 61 }]);
});

test('uncertain matches and assumed amounts are flagged for a look', () => {
  const [egg, bread, gran] = draftFrom([eggs, toast, granola]);
  assert.equal(needsLook(egg), false);
  assert.equal(needsLook(bread), true); // assumed portion
  assert.equal(needsLook(gran), true); // low confidence
});

test('amount options list USDA portions first, then grams and ounces, without duplicates', () => {
  const opts = amountOptions([{ description: 'slice', grams: 25 }, { description: 'Slice', grams: 25 }, { description: 'cup', grams: 0 }]);
  assert.deepEqual(opts.map((o) => o.label), ['slice', 'g', 'oz']);
});

test('setAmount ignores zero or negative counts', () => {
  const [item] = draftFrom([eggs]);
  assert.equal(setAmount(item, 0, { label: 'g', grams: 1 }), item);
});

test('a food picked from search needs an amount, and keeps grams you already chose', () => {
  const [egg] = draftFrom([eggs]);
  const oat = { id: 'oats', name: 'Oats', source: 'UsdaSrLegacy', quality: 'Standard' as const, per100g: per100(379, 13, 68, 6.5), portions: [{ description: 'cup', grams: 81 }] };
  const picked = withPickedFood(egg, oat);
  assert.equal(picked.group.matches.at(-1)!.food.id, 'oats');
  assert.equal(picked.grams, null);
  assert.equal(picked.status, 'NeedsAmount');
  assert.equal(blockers([picked]).length, 1);

  const mine = withPickedFood(setAmount(egg, 80, { label: 'g', grams: 1 }), oat);
  assert.equal(mine.grams, 80);
  assert.deepEqual(toRequest([mine]), [{ foodId: 'oats', grams: 80 }]);
  assert.equal(withPickedFood(egg, egg.group.matches[1].food).matchIndex, 1); // already a choice → just select it
});
