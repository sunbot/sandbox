import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BrandedFood, Food, Nutrition, RecipeSummary } from '../../api/types';
import { brandedNotice, brandedRow, localRow, packagedFirst, recipeMatches, recipeRow, rowLabel, withoutSaved } from './foodRows.ts';

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

const recipe = (over: Partial<RecipeSummary> = {}): RecipeSummary => ({
  id: 'r1', name: 'Turkey chili', servings: 6, origin: 'Manual', categories: [], isFavorite: false, hasPhoto: false,
  perServing: { calories: 412.4, protein: 31.2, carbs: 30, fat: 14.6, fiber: 9, nutrients: {} }, coverage: 1, ...over,
});

test('your recipes read per serving and are marked as recipes, not foods', () => {
  const row = recipeRow(recipe());
  assert.equal(row.source, 'Your recipe');
  assert.equal(row.basis, 'per serving · makes 6');
  assert.equal(row.calories, 412);
  assert.equal(row.note, null);
  assert.equal(recipeRow(recipe({ coverage: 0.75 })).note, '75% of ingredients counted');
  assert.match(rowLabel(row), /Your recipe/);
});

test('recipe matches put names that start with the search first and never offer the recipe being edited', () => {
  const list = [recipe({ id: 'a', name: 'Spicy turkey chili' }), recipe({ id: 'b', name: 'Turkey chili' }), recipe({ id: 'c', name: 'Turkey burgers' })];
  assert.deepEqual(recipeMatches(list, 'turkey').map((r) => r.id), ['b', 'c', 'a']);
  assert.deepEqual(recipeMatches(list, 'turkey', 'b').map((r) => r.id), ['c', 'a']);
  assert.deepEqual(recipeMatches(list, 't'), []);
});

test('a recipe found through an ingredient says so, and name matches come first (#84)', async () => {
  const { matchNote, recipeMatches } = await import('./foodRows.ts');
  assert.equal(matchNote({ matchedOn: 'Ingredient', matchedText: '1 tbsp apple cider vinegar' }), 'Matches ingredient: 1 tbsp apple cider vinegar');
  assert.equal(matchNote({ matchedOn: 'Description', matchedText: null }), 'Matches description');
  assert.equal(matchNote({ matchedOn: null }), null);
  const base = { servings: 4, origin: 'Manual', categories: [], isFavorite: false, hasPhoto: false, perServing: { calories: 1, protein: 0, carbs: 0, fat: 0, fiber: 0, nutrients: {} }, coverage: 1 };
  const chili = { ...base, id: 'c', name: 'Smoky Chipotle Beef Chili', matchedOn: 'Ingredient' as const, matchedText: '1 tbsp apple cider vinegar' };
  const pie = { ...base, id: 'p', name: 'Grandma’s apple pie' };
  assert.deepEqual(recipeMatches([chili, pie], 'apple').map((r) => r.id), ['p', 'c']);
});
