import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Ingredient, Nutrition } from '../../api/types';
import {
  availableModes, calorieShare, closedEditor, syncGramsEditor, typeGrams, eatingNutrition, effectiveMode, gramsPerServing, ingredientCounts, ingredientState, logRecipeRequest,
  macroComposition, nutritionFor, parseServings, per100gAvailable, reliabilityNote, roundedPercents, scaleNutrition, servingsWord,
} from './nutritionView.ts';

const nut = (calories: number, protein: number, carbs: number, fat: number, fiber = 0, nutrients: Record<string, number> = {}): Nutrition => ({ calories, protein, carbs, fat, fiber, nutrients });
const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

/* ── macro composition ── */

test('composition uses energy (4/4/9), not gram proportions', () => {
  // 30 g protein, 30 g carbs, 10 g fat: equal grams for protein/carbs, but fat's 10 g is 90 kcal.
  const c = macroComposition(nut(330, 30, 30, 10));
  assert.equal(c.macroKcal, 330);
  assert.deepEqual(c.shares.map((s) => s.kcal), [120, 120, 90]);
  near(c.shares[2].fraction, 90 / 330);
  assert.deepEqual(c.shares.map((s) => s.percent), [37, 36, 27]);
  assert.equal(c.gapKcal, 0);
  assert.equal(c.gapNotable, false);
});

test('displayed percentages always add to exactly 100', () => {
  for (const [p, c, f] of [[1, 1, 1], [33, 33, 34], [10, 20, 7], [0.1, 99.9, 0.3], [5, 0, 5]]) {
    const sum = macroComposition(nut(0, p, c, f)).shares.reduce((a, s) => a + s.percent, 0);
    assert.equal(sum, 100, `${p}/${c}/${f}`);
  }
  assert.deepEqual(roundedPercents([1, 1, 1]), [34, 33, 33]);
});

test('zero, missing and invalid macros produce an empty composition, not NaN', () => {
  for (const n of [nut(0, 0, 0, 0), nut(100, NaN, undefined as unknown as number, -5), nut(50, 0, 0, 0)]) {
    const c = macroComposition(n);
    assert.equal(c.hasData, false);
    assert.equal(c.macroKcal, 0);
    assert.ok(c.shares.every((s) => s.percent === 0 && s.fraction === 0 && Number.isFinite(s.kcal)));
  }
});

test('one macro only is 100% of that macro', () => {
  const c = macroComposition(nut(36, 0, 0, 4));
  assert.deepEqual(c.shares.map((s) => s.percent), [0, 0, 100]);
});

test('the macro/reported energy gap is reported, never forced to agree', () => {
  // 10 g fiber-heavy carbs: reported 360 kcal but macros imply 400 → gap -40, notable.
  const c = macroComposition(nut(360, 0, 100, 0, 40));
  assert.equal(c.macroKcal, 400);
  assert.equal(c.gapKcal, -40);
  assert.equal(c.gapNotable, true);
  // The reported calories are untouched by the composition.
  assert.equal(macroComposition(nut(1234, 1, 1, 1)).gapKcal, 1234 - 17);
  // A small difference is not called out.
  assert.equal(macroComposition(nut(405, 0, 100, 0)).gapNotable, false);
});

/* ── display modes ── */

const basis = { perServing: nut(400, 30, 40, 12, 5, { '1087': 100 }), servings: 4, cookedWeightGrams: 1000 };

test('per serving is the stored value; whole recipe is × servings made', () => {
  assert.equal(nutritionFor(basis, 'serving'), basis.perServing);
  const r = nutritionFor(basis, 'recipe')!;
  assert.equal(r.calories, 1600);
  assert.equal(r.protein, 120);
  assert.equal(r.fiber, 20);
  assert.equal(r.nutrients['1087'], 400);
});

test('per 100 g = whole recipe ÷ cooked weight × 100, only with a real weight', () => {
  const p = nutritionFor(basis, 'per100g')!;
  near(p.calories, 160); // 1600 kcal over 1000 g
  near(p.protein, 12);
  assert.equal(gramsPerServing(basis), 250);
  for (const w of [undefined, null, 0, -5]) {
    const b = { ...basis, cookedWeightGrams: w };
    assert.equal(per100gAvailable(b), false);
    assert.equal(nutritionFor(b, 'per100g'), null);
    assert.deepEqual(availableModes(b), ['serving', 'recipe']);
    assert.equal(gramsPerServing(b), null);
    assert.equal(effectiveMode('per100g', b), 'serving');
  }
  assert.deepEqual(availableModes(basis), ['serving', 'recipe', 'per100g']);
  assert.equal(effectiveMode('per100g', basis), 'per100g');
});

test('fractional yields scale correctly and a bad yield falls back to 1', () => {
  assert.equal(nutritionFor({ ...basis, servings: 2.5 }, 'recipe')!.calories, 1000);
  assert.equal(nutritionFor({ ...basis, servings: 0 }, 'recipe')!.calories, 400);
  near(nutritionFor({ ...basis, servings: 1.5, cookedWeightGrams: 300 }, 'per100g')!.calories, 200); // 600 kcal / 300 g
});

test('per-serving, whole-recipe and per-100g agree with each other', () => {
  const s = nutritionFor(basis, 'serving')!, r = nutritionFor(basis, 'recipe')!, p = nutritionFor(basis, 'per100g')!;
  near(r.calories / basis.servings, s.calories);
  near((p.calories * basis.cookedWeightGrams) / 100, r.calories);
});

test('the eating quantity is independent of yield and display mode, and allows fractions', () => {
  const half = eatingNutrition(basis.perServing, 0.5);
  assert.equal(half.calories, 200);
  assert.equal(eatingNutrition(basis.perServing, 2.25).calories, 900);
  assert.equal(eatingNutrition(basis.perServing, 0).calories, 0);
  assert.equal(eatingNutrition(basis.perServing, -1).calories, 0);
});

test('scaling never invents values for unknown nutrients', () => {
  const s = scaleNutrition(nut(100, 1, 1, 1, 0, { '1087': 50 }), 2);
  assert.deepEqual(Object.keys(s.nutrients), ['1087']);
  assert.equal(s.nutrients['1087'], 100);
});

test('servings text is parsed strictly', () => {
  assert.equal(parseServings('1.5'), 1.5);
  assert.equal(parseServings('1,5'), 1.5);
  assert.equal(parseServings(' 2 '), 2);
  for (const bad of ['', '0', '-1', 'abc', '1e9', '2000']) assert.equal(parseServings(bad), null, bad);
  assert.equal(servingsWord(1), '1 serving');
  assert.equal(servingsWord(1.5), '1.5 servings');
});

/* ── ingredients ── */

const ing = (over: Partial<Ingredient>): Ingredient => ({ position: 0, rawText: 'x', foodText: 'x', status: 'AutoMatched', matchConfidence: 0.9, grams: 100, nutrition: nut(50, 1, 1, 1), ...over });

test('each ingredient falls in exactly one clearly named state', () => {
  assert.equal(ingredientState(ing({ status: 'Ignored', note: 'Section header' })), 'header');
  assert.equal(ingredientState(ing({ status: 'Ignored', note: 'Left out' })), 'excluded');
  assert.equal(ingredientState(ing({ status: 'Ignored', note: null })), 'excluded');
  assert.equal(ingredientState(ing({ status: 'Unmatched' })), 'unmatched');
  assert.equal(ingredientState(ing({ status: 'Confirmed' })), 'confirmed');
  assert.equal(ingredientState(ing({ status: 'AutoMatched', grams: null })), 'check');
  assert.equal(ingredientState(ing({ status: 'AutoMatched', matchConfidence: 0.3 })), 'check');
  assert.equal(ingredientState(ing({ status: 'AutoMatched' })), 'matched');
});

test('counts ignore section headers and separate left-out from unmatched', () => {
  const c = ingredientCounts([
    ing({ status: 'Ignored', note: 'Section header', nutrition: null }),
    ing({}), ing({ status: 'Confirmed' }), ing({ status: 'AutoMatched', grams: null, nutrition: null }),
    ing({ status: 'Unmatched', nutrition: null, grams: null }), ing({ status: 'Ignored', note: 'Left out', nutrition: null }),
  ]);
  assert.deepEqual(c, { total: 5, counted: 2, unmatched: 1, check: 1, excluded: 1, confirmed: 1 });
});

test('full coverage is described as calculated, not verified', () => {
  const full = reliabilityNote(1, { total: 8, counted: 8, unmatched: 0, check: 0, excluded: 0, confirmed: 2 });
  assert.equal(full.level, 'complete');
  assert.match(full.text, /Calculated from all 8/);
  assert.match(full.text, /Check that each match/);
  assert.doesNotMatch(full.text, /accurate|verified|exact/i);
});

test('partial coverage says what is missing and that totals are minimums', () => {
  const p = reliabilityNote(0.75, { total: 8, counted: 6, unmatched: 1, check: 0, excluded: 1, confirmed: 0 });
  assert.equal(p.level, 'partial');
  assert.match(p.text, /75%/);
  assert.match(p.text, /1 unmatched/);
  assert.match(p.text, /1 left out/);
  assert.match(p.text, /minimums/);
  // 100% reported coverage but an ingredient still needs checking is not "complete".
  assert.equal(reliabilityNote(1, { total: 3, counted: 3, unmatched: 0, check: 1, excluded: 0, confirmed: 0 }).level, 'partial');
});

test('calorie share is null when unknown and rounded otherwise', () => {
  assert.equal(calorieShare(null, 500), null);
  assert.equal(calorieShare(50, 0), null);
  assert.equal(calorieShare(125, 500), 25);
});

/* ── logging ── */

test('Log now sends the meal the user selected, not a time-of-day guess', () => {
  for (const meal of ['Breakfast', 'Lunch', 'Dinner', 'Snack'] as const) {
    assert.equal(logRecipeRequest({ date: '2026-11-21', meal, recipeId: 'r1', servings: 1.5 }).meal, meal);
  }
  assert.deepEqual(logRecipeRequest({ date: '2026-11-21', meal: 'Lunch', recipeId: 'r1', servings: 2 }), { date: '2026-11-21', meal: 'Lunch', recipeId: 'r1', servings: 2 });
});

/* ── ingredient amount editor ── */

test('the grams box starts from the current data every time the sheet opens, even for the same ingredient', () => {
  let e = syncGramsEditor(closedEditor, { position: 2, grams: 100 });
  assert.equal(e.text, '100');
  e = syncGramsEditor(typeGrams(e, '150'), null);           // saved / closed
  assert.deepEqual(e, closedEditor);
  e = syncGramsEditor(e, { position: 2, grams: 150 });      // reopen the same ingredient after the save
  assert.equal(e.text, '150');
  e = syncGramsEditor(syncGramsEditor(e, null), { position: 2, grams: 80 }); // data changed elsewhere (new food), reopen
  assert.equal(e.text, '80');
});

test('typing is kept while the sheet stays open, even if the data refreshes', () => {
  let e = syncGramsEditor(closedEditor, { position: 1, grams: 100 });
  e = typeGrams(e, '12');
  e = syncGramsEditor(e, { position: 1, grams: 90 });        // refetch while open
  assert.equal(e.text, '12');
});

test('an untouched box follows a refresh while open, and switching ingredient resets', () => {
  let e = syncGramsEditor(closedEditor, { position: 1, grams: 100 });
  e = syncGramsEditor(e, { position: 1, grams: 90 });
  assert.equal(e.text, '90');
  e = syncGramsEditor(typeGrams(e, '5'), { position: 3, grams: null });
  assert.deepEqual(e, { openFor: 3, text: '', dirty: false });
});

test('syncing an unchanged state returns the same object (no render loop)', () => {
  const e = syncGramsEditor(closedEditor, { position: 1, grams: 100 });
  assert.equal(syncGramsEditor(e, { position: 1, grams: 100 }), e);
  assert.equal(syncGramsEditor(closedEditor, null), closedEditor);
});
