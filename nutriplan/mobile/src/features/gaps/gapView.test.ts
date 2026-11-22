import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calorieHeadline, effectLine, emptyCopy, fmtAmount, fmtInt, macroText, modeChips, planPayload, shortOn, suggestionId } from './gapView.ts';

test('an overage is stated with its amount, never shown as zero left', () => {
  assert.deepEqual(calorieHeadline(-1214, 'Over'), { text: '1,214 kcal over', over: true });
  assert.deepEqual(calorieHeadline(420, 'Open'), { text: '420 kcal left', over: false });
  assert.deepEqual(calorieHeadline(30, 'AtTarget'), { text: 'On target', over: false });
  assert.deepEqual(macroText(-12.4), { text: '12 g over', over: true });
  assert.deepEqual(macroText(0.2), { text: '0.2 g left', over: false });
  assert.equal(fmtInt(-1234567), '1,234,567');
  assert.equal(fmtAmount(-0.04), '0');
});

test('only modes that lead somewhere are offered, plus the one picked', () => {
  assert.deepEqual(modeChips([{ mode: 'BestMatch', count: 3 }], 'BestMatch'), ['BestMatch']);
  assert.deepEqual(modeChips([{ mode: 'BestMatch', count: 3 }, { mode: 'Pantry', count: 1 }, { mode: 'SavedRecipes', count: 0 }], 'BestMatch'), ['BestMatch', 'Pantry']);
  // A picked mode that now has nothing stays visible (with its empty state) and Best match is offered to go back.
  assert.deepEqual(modeChips([{ mode: 'BestMatch', count: 2 }], 'Pantry'), ['BestMatch', 'Pantry']);
  assert.deepEqual(modeChips([], 'BestMatch'), ['BestMatch']);
  assert.deepEqual(modeChips([{ mode: 'Meal', count: 1 }, { mode: 'QuickSnack', count: 2 }, { mode: 'BestMatch', count: 3 }], 'Meal'), ['BestMatch', 'Meal', 'QuickSnack']);
});

test('effects read as plain before/after sentences', () => {
  assert.equal(effectLine({ nutrientId: 1003, name: 'Protein', unit: 'g', kind: 'Goal', before: 32, after: 14 }), 'Protein: 32 → 14 g short');
  assert.equal(effectLine({ nutrientId: 1079, name: 'Fiber', unit: 'g', kind: 'Goal', before: 6, after: 0 }), 'Fiber: 6 g short → covered');
  assert.equal(effectLine({ nutrientId: 1093, name: 'Sodium', unit: 'mg', kind: 'Limit', before: 900, after: 780 }), 'Sodium: 900 → 780 mg room left');
});

test('plan payload sends foods together by grams and recipes by servings', () => {
  const n = { calories: 1, protein: 1, carbs: 1, fat: 1 } as never;
  const p = planPayload([
    { kind: 'Food', foodId: 'f1', name: 'A', amount: 170, unit: 'g', nutrition: n, portion: '' },
    { kind: 'Recipe', recipeId: 'r1', name: 'B', amount: 1.5, unit: 'serving', nutrition: n, portion: '' },
  ]);
  assert.deepEqual(p.foods, [{ foodId: 'f1', grams: 170 }]);
  assert.deepEqual(p.recipes, [{ recipeId: 'r1', servings: 1.5 }]);
});

test('"short on" never names a nutrient the day’s data can’t support', () => {
  const g = (nutrientId: number, name: string, dataComplete = true, kind = 'Goal') => ({ nutrientId, name, unit: 'g', remaining: 5, target: 10, kind, dataComplete });
  assert.deepEqual(shortOn([g(1008, 'Energy'), g(1003, 'Protein'), g(1079, 'Fiber', false), g(1087, 'Calcium'), g(1093, 'Sodium', true, 'Limit')]), ['protein', 'calcium']);
});

test('empty states explain why, in different words for each reason', () => {
  const base = { situation: 'Open', mode: 'BestMatch', emptyMessage: 'msg' } as const;
  const titles = ['Over', 'AtTarget', 'NeedsMet', 'NoPantry', 'NoRecipes', 'NoRoomForMeal', 'NothingFits'].map((r) => emptyCopy({ ...base, emptyReason: r }).title);
  assert.equal(new Set(titles).size, titles.length);
  assert.equal(emptyCopy({ ...base, emptyReason: 'Over' }).body, 'msg');
});

test('a suggestion keeps the same id when the list reorders, and differs when its contents differ', () => {
  const a = [{ foodId: 'f1', recipeId: null, amount: 170 }];
  const b = [{ foodId: 'f1', recipeId: null, amount: 85 }];
  const c = [{ foodId: null, recipeId: 'r1', amount: 1 }];
  assert.equal(suggestionId(a), suggestionId([{ ...a[0] }]));
  assert.notEqual(suggestionId(a), suggestionId(b));
  assert.notEqual(suggestionId(a), suggestionId(c));
  assert.equal(suggestionId([...a, ...c]), 'f1:170|r1:1');
});
