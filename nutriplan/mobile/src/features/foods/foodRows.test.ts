import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BrandedFood, Food, Nutrition } from '../../api/types';
import { brandedNotice, brandedRow, localRow, packagedFirst, rowLabel, withoutSaved } from './foodRows.ts';

const n = (calories: number, protein: number, carbs: number, fat: number, withKcal = true): Nutrition =>
  ({ calories, protein, carbs, fat, fiber: 0, nutrients: withKcal ? { '1008': calories, '1003': protein } : { '1003': protein } });

const food = (over: Partial<Food>): Food => ({ id: 'f', name: 'Chicken breast, raw', source: 'UsdaSrLegacy', quality: 'Verified', per100g: n(120, 22.5, 0, 2.6), portions: [], ...over });

test('generic foods read per 100 g', () => {
  const r = localRow(food({ portions: [{ description: 'breast', grams: 172 }] }));
  assert.equal(r.basis, 'per 100 g');
  assert.equal(r.calories, 120);
  assert.equal(r.source, 'USDA');
});

test('packaged foods read per labelled serving', () => {
  const r = localRow(food({ name: 'White Bread', brand: "Dave's Killer Bread", source: 'UsdaBranded', per100g: n(275, 7.5, 52.5, 5), portions: [{ description: 'slice', grams: 40 }] }));
  assert.equal(r.basis, 'slice (40 g)');
  assert.equal(r.calories, 110);
  assert.equal(r.macros, 'P 3 g · C 21 g · F 2 g');
  assert.equal(r.source, 'USDA branded');
});

test('drinks labelled by volume stay in ml', () => {
  const r = localRow(food({ name: 'High Protein Shake', source: 'UsdaBranded', baseUnit: 'ml', per100g: n(48, 9.1, 1.5, 0.9), portions: [{ description: 'shake', grams: 330 }] }));
  assert.equal(r.basis, 'shake (330 ml)');
  assert.equal(r.calories, 158);
});

const branded = (over: Partial<BrandedFood>): BrandedFood => ({
  source: 'UsdaBranded', sourceId: '1', name: 'Plain Non-Fat Greek Yogurt', brand: 'Chobani', baseUnit: 'g', servingDescription: '1 container (170 g)', servingAmount: 170,
  per100: n(53, 10, 3.5, 0), perServing: n(90, 17, 6, 0), caloriesCalculated: false, caloriesMissing: false, ...over,
});

test('branded results show the label serving with calories and macros', () => {
  const r = brandedRow(branded({}));
  assert.deepEqual([r.brand, r.title, r.basis, r.calories, r.macros, r.note], ['Chobani', 'Plain Non-Fat Greek Yogurt', '1 container (170 g)', 90, 'P 17 g · C 6 g · F 0 g', null]);
  assert.match(rowLabel(r), /Chobani, Plain Non-Fat Greek Yogurt\. 1 container \(170 g\): 90 calories, protein 17 g/);
});

test('without a labelled serving size, branded results fall back to per 100 g — never a made-up serving', () => {
  const r = brandedRow(branded({ perServing: null, servingDescription: null, servingAmount: null }));
  assert.equal(r.basis, 'per 100 g');
  assert.equal(r.calories, 53);
});

test('missing calories are shown as unknown, calculated ones are labelled', () => {
  const missing = brandedRow(branded({ caloriesMissing: true, perServing: n(0, 17, 6, 0, false) }));
  assert.equal(missing.calories, null);
  assert.equal(missing.note, 'Calories not on the label');
  assert.match(rowLabel(missing), /calories unknown/);
  assert.equal(brandedRow(branded({ caloriesCalculated: true })).note, 'Calories calculated from macros');
  assert.equal(localRow(food({ per100g: n(0, 5, 5, 5, false), source: 'UsdaBranded' })).calories, null);
});

test('branded results already saved locally are not listed twice', () => {
  const local = [food({ id: 'saved' })];
  const out = withoutSaved([branded({ sourceId: 'a', localFoodId: 'saved' }), branded({ sourceId: 'b', localFoodId: null }), branded({ sourceId: 'c', localFoodId: 'elsewhere' })], local);
  assert.deepEqual(out.map((b) => b.sourceId), ['b', 'c']);
});

test('provider problems are explained and never block local results', () => {
  assert.equal(brandedNotice(null), null);
  for (const f of ['RateLimited', 'Timeout', 'Network', 'BadResponse']) assert.match(brandedNotice(f)!, /Your own foods still work/);
  assert.match(brandedNotice('NotConfigured')!, /USDA API key/);
});


test('a brand search not covered by your foods shows packaged products first', () => {
  const powerade = [{ name: 'Sports drink (Powerade)', brand: null }, { name: 'Beverages, POWERADE, Zero', brand: null }];
  assert.equal(packagedFirst('Fairlife Core Power', powerade, [{ brand: 'Core Power' }]), true);   // whole words: "power" ≠ "powerade"
});

test('generic searches and brands already in your foods keep your foods first', () => {
  const chicken = [{ name: 'Chicken, breast, meat and skin, raw', brand: null }];
  assert.equal(packagedFirst('chicken breast', chicken, [{ brand: 'Giant Eagle' }, { brand: 'Tyson' }]), false);
  const chobani = [{ name: 'Yogurt, Greek, whole, plain, CHOBANI', brand: null }];
  assert.equal(packagedFirst('Chobani greek yogurt', chobani, [{ brand: 'Chobani' }]), false);
  const daves = [{ name: 'Organic Bread', brand: "Dave's Killer Bread" }];
  assert.equal(packagedFirst("Dave's Killer Bread", daves, [{ brand: "Dave's Killer Bread" }]), false);
  assert.equal(packagedFirst("daves killer bread", [{ name: 'Bread, whole wheat', brand: null }], [{ brand: "Dave's Killer Bread" }]), true);
  assert.equal(packagedFirst('anything', [], []), false);
});
