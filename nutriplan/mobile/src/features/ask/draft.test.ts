/**
 * Tests for Ask's multi-food review draft. Run with `npm test` (Node's built-in test runner; no extra dependencies).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FoodMatch, FoodMatchGroup } from '../../api/types';
import { amountOptions, blockers, draftFrom, needsLook, otherPreparationIndex, preview, replaceItem, selectMatch, setAmount, setRemoved, toRequest, totals, withPickedFood } from './draft.ts';

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

test('switching food keeps the weight you set, not the previous food’s measure', () => {
  const items = draftFrom([eggs]);
  const chosen = setAmount(items[0], 3, { label: 'large', grams: 50, unit: 'large' });
  const other = selectMatch(chosen, 1);
  assert.equal(other.grams, 150);
  assert.equal(other.amount, null);
  assert.equal(other.amountLabel, '150 g');
  assert.deepEqual(toRequest([other]), [{ foodId: 'egg-boiled', grams: 150 }]);
});

test('a cleared or invalid amount blocks logging instead of keeping the old one', async () => {
  const { clearAmount } = await import('./draft.ts');
  const items = draftFrom([eggs]);
  const cleared = clearAmount(items[0]);
  assert.equal(blockers([cleared]).length, 1);
  assert.throws(() => toRequest([cleared]), /need a match or an amount/);
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

const chicken: FoodMatchGroup = {
  text: '4 oz chicken breast', amount: 4, unit: 'oz', foodQuery: 'chicken breast',
  matches: [
    { ...match('chk-raw', 'Chicken, breast, meat only, raw', per100(120, 22.5, 0, 2.6), { grams: 113.4, method: 'Mass', explanation: '4 oz = 113.4 g', status: 'Given' }),
      preparation: { state: 'Raw', note: 'Raw weight (120 kcal per 100 g).', otherFoodId: 'chk-cooked', otherState: 'Cooked' } },
    { ...match('chk-cooked', 'Chicken, breast, meat only, cooked, roasted', per100(165, 31, 0, 3.6), { grams: 113.4, method: 'Mass', explanation: '4 oz = 113.4 g', status: 'Given' }),
      preparation: { state: 'Cooked', note: 'Cooked weight.', otherFoodId: 'chk-raw', otherState: 'Raw' } },
  ],
};

test('4 oz of chicken needs no manual amount and keeps 113.4 g on either version', () => {
  const [item] = draftFrom([chicken]);
  assert.equal(item.grams, 113.4);
  assert.equal(item.amountLabel, '4 oz');
  assert.equal(blockers([item]).length, 0);
  const cooked = selectMatch(item, otherPreparationIndex(item));
  assert.equal(cooked.grams, 113.4);
  assert.equal(selectedFoodId(cooked), 'chk-cooked');
  assert.ok(preview(cooked)!.calories > preview(item)!.calories); // the states are never silently converted
});

test('switching raw/cooked keeps an amount you set yourself', () => {
  const [item] = draftFrom([chicken]);
  const edited = setAmount(item, 150, { label: 'g', grams: 1 });
  assert.equal(selectMatch(edited, 1).grams, 150);
});

test('no counterpart means no switch offered', () => {
  assert.equal(otherPreparationIndex(draftFrom([toast])[0]), -1);
});

test('the save request carries only food ids and grams', () => {
  assert.deepEqual(toRequest(draftFrom([chicken])), [{ foodId: 'chk-raw', grams: 113.4 }]);
});

function selectedFoodId(i: ReturnType<typeof draftFrom>[number]) { return i.group.matches[i.matchIndex].food.id; }

test('an amount chosen in one of the food’s measures is logged in that measure', () => {
  const items = draftFrom([granola]);
  const chosen = setAmount(items[0], 12, { label: 'almonds', grams: 1.2, unit: 'almond' });
  assert.equal(chosen.grams, 14.4);
  assert.equal(chosen.amountLabel, '12 almonds');
  assert.deepEqual(toRequest([chosen]), [{ foodId: 'granola', amount: 12, unit: 'almond' }]);
});
