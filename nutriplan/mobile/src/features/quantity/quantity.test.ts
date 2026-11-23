import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Item, Measure } from '../../api/types.ts';
import { ingredientSelection, measureWorth, checkQuantity, convert, formatQuantity, initialSelection, matchMeasure, measureText, measuresForItem, parseQuantity, scaleFactor, SERVING, volumeNote } from './quantity.ts';

const m = (unit: string, base: number, kind: Measure['kind'] = 'Count', plural = unit + 's'): Measure => ({ unit, label: unit, plural, base, kind, source: null, countable: kind === 'Count' });
const almond = m('almond', 1.2);
const cup = m('cup', 143, 'Volume', 'cups');
const tbsp = m('tbsp', 8.9375, 'Volume', 'tbsp');
const g = m('g', 1, 'Mass', 'g');
const oz = m('oz', 28.349523, 'Mass', 'oz');
const almonds = [almond, cup, tbsp, g, oz];
const item = (over: Partial<Item>): Item => ({ kind: 'Food', foodId: 'f', name: 'Almonds', quantity: 28, unit: 'g', grams: 28, nutrition: { calories: 162, protein: 6, carbs: 6, fat: 14, fiber: 3.5, nutrients: {} }, ...over });

test('typed amounts: whole numbers, decimals with either separator, and fractions', () => {
  for (const [text, n] of [['12', 12], ['0.5', 0.5], ['0,5', 0.5], ['.5', 0.5], ['1/2', 0.5], ['1 1/2', 1.5], ['½', 0.5], ['1½', 1.5], ['1 ½', 1.5], [' 2 ', 2], ['0', 0]] as const)
    assert.equal(parseQuantity(text), n, text);
  for (const bad of ['', 'abc', '-1', '1/0', '1..2', '2 eggs', '1,2,3', '½½', '1.5½'])
    assert.equal(parseQuantity(bad), null, bad);
});

test('invalid and zero amounts cannot be saved; implausible ones are caught', () => {
  assert.equal(checkQuantity(null, g).ok, false);
  assert.equal(checkQuantity(0, g).ok, false);
  assert.equal(checkQuantity(-1, g).ok, false);
  assert.equal(checkQuantity(12, undefined).ok, false);
  assert.equal(checkQuantity(6000, g).ok, false);
  assert.equal(checkQuantity(60, SERVING, true).ok, false);
  assert.deepEqual(checkQuantity(12, almond), { ok: true, base: 14.399999999999999 });
});

test('switching measures keeps the physical amount', () => {
  assert.equal(convert(12, almond, g), 14.4);
  assert.equal(convert(28, g, oz), 0.99);
  assert.equal(convert(1, oz, g), 28.3);
  assert.equal(convert(2, tbsp, g), 17.9);           // only because USDA measured a cup of almonds
  assert.equal(convert(0.5, cup, almond), 59.58);
  assert.equal(convert(3, g, g), 3);
});

test('stored units are matched to measures by unit, plural or common name', () => {
  assert.equal(matchMeasure(almonds, 'almonds'), almond);
  assert.equal(matchMeasure(almonds, 'grams'), g);
  assert.equal(matchMeasure(almonds, 'Ounces'), oz);
  assert.equal(matchMeasure(almonds, 'tablespoons'), tbsp);
  assert.equal(matchMeasure(almonds, 'slice'), undefined);
});

test('the nutrition preview scales exactly as the server will', () => {
  assert.equal(scaleFactor(item({}), 56, g, almonds), 2);                                 // same unit: ratio of amounts
  assert.ok(Math.abs(scaleFactor(item({}), 12, almond, almonds)! - 14.4 / 28) < 1e-9);    // other unit: ratio of weights
  assert.equal(scaleFactor(item({ unit: 'almond', quantity: 10, grams: 12 }), 1, oz, almonds), 28.349523 / 12);
  // A drink entry with no recorded weight, in a unit the food lists: converted through that measure.
  const bottle = m('bottle', 340), mlCup = m('cup', 236.588, 'Volume', 'cups');
  assert.ok(Math.abs(scaleFactor(item({ unit: 'bottle', quantity: 1, grams: null }), 1, mlCup, [bottle, mlCup])! - 236.588 / 340) < 1e-9);
  // Unknown old weight and an unknown unit: can't be worked out, so no guess.
  assert.equal(scaleFactor(item({ unit: 'handful', quantity: 1, grams: null }), 2, g, almonds), null);
});

test('an old entry in a unit the food no longer lists can still change in that unit', () => {
  const old = item({ unit: 'handful', quantity: 1, grams: 30 });
  const list = measuresForItem(old, almonds);
  assert.equal(list[0].unit, 'handful');
  assert.equal(list[0].base, 30);
  assert.deepEqual(initialSelection(old, list), { text: '1', unit: 'handful' });
  assert.deepEqual(measuresForItem(item({ kind: 'Recipe', unit: 'servings', quantity: 1.5 }), almonds), [SERVING]);
  assert.deepEqual(initialSelection(item({ kind: 'Recipe', unit: 'servings', quantity: 1.5 }), [SERVING]), { text: '1.5', unit: 'serving' });
});

test('labels read naturally and the missing-volume note is explained only when relevant', () => {
  assert.equal(measureText(almond, 12), '12 almonds');
  assert.equal(measureText(almond, 1), '1 almond');
  assert.equal(formatQuantity(1 / 3), '0.33');
  assert.equal(volumeNote([almond, g, oz], 'g'), 'No cup or spoon measures: USDA lists no volume weight for this food.');
  assert.equal(volumeNote(almonds, 'g'), null);
  assert.equal(volumeNote([m('bottle', 340)], 'ml'), null);
});

test('a new log starts on the natural item, else on the given grams or 100 g', async () => {
  const { startingSelection, previewPer100 } = await import('./quantity.ts');
  assert.deepEqual(startingSelection(almonds, 'g'), { text: '1', unit: 'almond' });
  assert.deepEqual(startingSelection([g, oz], 'g'), { text: '100', unit: 'g' });
  assert.deepEqual(startingSelection(almonds, 'g', 42), { text: '42', unit: 'g' });
  assert.deepEqual(startingSelection([m('ml', 1, 'Volume', 'ml')], 'ml'), { text: '100', unit: 'ml' });
  assert.ok(Math.abs(previewPer100({ calories: 579, protein: 21, carbs: 22, fat: 50, fiber: 12.5 }, 14.4).calories - 83.376) < 1e-9);
});

test('logged amounts read naturally', async () => {
  const { amountText } = await import('./quantity.ts');
  assert.equal(amountText(12, 'almond'), '12 almonds');
  assert.equal(amountText(1, 'almond'), '1 almond');
  assert.equal(amountText(2, 'cup'), '2 cups');
  assert.equal(amountText(28, 'g'), '28 g');
  assert.equal(amountText(2, 'large'), '2 large');
  assert.equal(amountText(1.5, 'servings'), '1.5 servings');
  assert.equal(amountText(2, 'patty'), '2 patties');
  assert.equal(amountText(2, 'medium (7" long)'), '2 medium (7" long)'); // an old USDA description is left as it is
});

test('review regressions: thousands-looking commas, tiny amounts, litres, plural units', async () => {
  const q = await import('./quantity.ts');
  assert.equal(q.parseQuantity('1,000'), null);   // could be 1000 or 1.000: not guessed
  assert.equal(q.parseQuantity('1,5'), 1.5);
  assert.equal(q.parseQuantity('0,25'), 0.25);
  assert.equal(q.parseQuantity('1,2500'), 1.25);
  assert.equal(q.checkQuantity(0.0004, g).ok, false);
  assert.equal(q.checkQuantity(0.005, g).ok, false);
  assert.equal(q.checkQuantity(0.01, g).ok, true);
  const ml = m('ml', 1, 'Volume', 'ml');
  assert.match((q.checkQuantity(6000, ml, false, 'ml') as { message: string }).message, /litres/);
  assert.equal(q.roundAmount(1 / 3), 0.333);
  // Plural spellings are the same unit, as on the server: a same-unit edit scales by the ratio of amounts.
  assert.equal(q.sameUnit('almonds', 'almond', almonds), true);
  assert.equal(q.sameUnit('ounces', 'oz', almonds), true);
  assert.equal(q.scaleFactor(item({ unit: 'almond', quantity: 10, grams: 15 }), 20, almond, almonds), 2);
  assert.equal(q.matchMeasure(almonds, 'T'), tbsp);
});

test('browsing measures and coming back gives back exactly what was typed', async () => {
  const { switchMeasure } = await import('./quantity.ts');
  let v = switchMeasure('12', almond, oz, null);
  assert.equal(v.text, '0.51');
  v = switchMeasure(v.text, oz, g, v.exact);
  assert.equal(v.text, '14.4');
  v = switchMeasure(v.text, g, almond, v.exact);
  assert.equal(v.text, '12');                 // not 12.05
  // Typing a new number starts from that number.
  const typed = switchMeasure('1', oz, almond, v.exact);
  assert.equal(typed.text, '23.62');
  // An amount that isn't a number is kept as typed.
  assert.deepEqual(switchMeasure('abc', g, oz, null), { text: 'abc', exact: null });
});

test('USDA phrase measures: one label everywhere, natural plurals, and where a borrowed weight comes from', async () => {
  const { amountText, capitalize, sourceText, unitFor, switchMeasure } = await import('./quantity.ts');
  // As the server sends "Almonds, NFS": the 100-calorie package is its own measure, never "calorie".
  const pack: Measure = { unit: '100-calorie package', label: '100-calorie package', plural: '100-calorie packages', base: 18, kind: 'Count', source: '100 calorie package', countable: true };
  const nut = m('nut', 1.2);
  const package50 = m('package', 50);
  const nfs = [pack, nut, package50, g, oz];
  assert.equal(matchMeasure(nfs, '100-calorie package'), pack);
  assert.equal(matchMeasure(nfs, '100-calorie packages'), pack);
  assert.equal(matchMeasure(nfs, 'package'), package50); // the plain package is a different weight
  assert.equal(measureText(pack, 2), '2 100-calorie packages');
  assert.equal(amountText(2, '100-calorie package'), '2 100-calorie packages'); // a diary row shows the stored unit
  assert.equal(amountText(1, '100-calorie package'), '1 100-calorie package');
  assert.equal(amountText(3, '1-3 ring thin pretzel'), '3 1-3 ring thin pretzels');
  assert.equal(unitFor(2, 'berry'), 'berries');
  assert.equal(unitFor(2, 'medium (7" long)'), 'medium (7" long)');
  assert.equal(capitalize('100-calorie package'), '100-calorie package');
  assert.equal(capitalize('almond'), 'Almond');
  assert.equal(capitalize('cup'), 'Cup');
  for (const u of ['g', 'oz', 'tbsp', 'tsp', 'ml', 'fl oz']) assert.equal(capitalize(u), u);
  // An old entry logged as "calorie" isn't one of the food's measures: it's offered as-is, keeping its own weight.
  const old = measuresForItem(item({ quantity: 1, unit: 'calorie', grams: 18 }), nfs);
  assert.equal(old[0].unit, 'calorie');
  assert.equal(old[0].base, 18);
  // Package ↔ count ↔ grams round-trips without drift.
  let s = switchMeasure('1', pack, nut, null);
  assert.equal(s.text, '15');
  s = switchMeasure(s.text, nut, g, s.exact);
  assert.equal(s.text, '18');
  s = switchMeasure(s.text, g, pack, s.exact);
  assert.equal(s.text, '1');
  // Provenance: the food's own USDA wording, or the linked record it was borrowed from.
  assert.equal(sourceText(pack), 'From USDA: 100 calorie package');
  const borrowed: Measure = { ...almond, source: 'almond', origin: 'USDA SR Legacy “Nuts, almonds” (FDC 170567, same NDB 12061)' };
  assert.equal(sourceText(borrowed), 'From USDA SR Legacy “Nuts, almonds” (FDC 170567, same NDB 12061): almond');
  assert.equal(sourceText(g), null);
});

test('recipe items edit in the recipe\'s own measures, compared in servings (never grams)', () => {
  const soup: Measure[] = [SERVING, { unit: 'cup', label: 'cup', plural: 'cups', base: 0.5, kind: 'Volume', source: 'finished volume', countable: false },
    { unit: 'g', label: 'g', plural: 'g', base: 0.002, kind: 'Mass', source: 'finished weight', countable: false }];
  const byCup = item({ kind: 'Recipe', unit: 'cup', quantity: 1, grams: 250 });
  assert.equal(measuresForItem(byCup, undefined, soup), soup);
  assert.deepEqual(initialSelection(byCup, soup), { text: '1', unit: 'cup' });
  // 1 cup (0.5 serving) → 2 servings: ×4, from servings, not from the 250 g it weighed.
  assert.equal(scaleFactor(byCup, 2, SERVING, soup), 4);
  assert.equal(scaleFactor(byCup, 3, soup[1], soup), 3);
  // A recipe whose finished volume was removed: its own unit is still offered (same-unit changes only).
  const own = measuresForItem(byCup, undefined, [SERVING]);
  assert.equal(own[0].unit, 'cup');
  assert.equal(own[0].base, 0);
  assert.equal(scaleFactor(byCup, 1, SERVING, own), null);
  // Servings limit applies to the servings, whatever the measure: 200 g is 0.4 servings, fine; 30 cups is 15, fine; 120 cups is 60, too many.
  assert.ok(checkQuantity(200, soup[2], true).ok);
  assert.ok(checkQuantity(30, soup[1], true).ok);
  assert.equal(checkQuantity(120, soup[1], true).ok, false);
});

test('a recipe measure reads as servings, or per serving when one unit is a tiny fraction', () => {
  const cup: Measure = { unit: 'cup', label: 'cup', plural: 'cups', base: 0.5, kind: 'Volume', source: null, countable: false };
  const gram: Measure = { unit: 'g', label: 'g', plural: 'g', base: 0.002, kind: 'Mass', source: null, countable: false };
  const oz: Measure = { unit: 'oz', label: 'oz', plural: 'oz', base: 28.349523 * 0.002, kind: 'Mass', source: null, countable: false };
  assert.equal(measureWorth(cup, 'serving'), '0.5 servings');
  assert.equal(measureWorth(gram, 'serving'), '500 g per serving');
  assert.equal(measureWorth(oz, 'serving'), '17.6 oz per serving');
  assert.equal(measureWorth({ ...cup, base: 143 }, 'g'), '143 g');
});

test('a logged recipe converts from its own saved servings, not from the recipe\'s current volume', () => {
  // Logged as 1 cup when a cup was 1 serving; the soup now makes 8 cups for 4 servings (a cup is 0.5 serving).
  const now: Measure[] = [SERVING, { unit: 'cup', label: 'cup', plural: 'cups', base: 0.5, kind: 'Volume', source: null, countable: false }];
  const entry = item({ kind: 'Recipe', unit: 'cup', quantity: 1, servings: 1 });
  assert.equal(scaleFactor(entry, 1, SERVING, now), 1);   // 1 serving → same as logged
  assert.equal(scaleFactor(entry, 2, now[1], now), 2);    // same unit: ratio of amounts
});

const mm = (unit: string, base: number, kind: Measure['kind'] = 'Count'): Measure => ({ unit, label: unit, plural: `${unit}s`, base, kind, source: null, countable: kind === 'Count' });
const oats = [mm('cup', 81, 'Volume'), mm('g', 1, 'Mass'), mm('oz', 28.35, 'Mass')];

test('a line edits in its own measure when the food has it', () => {
  assert.deepEqual(ingredientSelection({ amount: 1.5, unit: 'cups', grams: 121.5 }, oats), { text: '1.5', unit: 'cup' });
});

test('a line whose measure the food lacks starts from its grams; with neither, from the food\'s natural item (else 100 g)', () => {
  assert.deepEqual(ingredientSelection({ amount: 2, unit: 'handful', grams: 60 }, oats), { text: '60', unit: 'g' });
  assert.deepEqual(ingredientSelection({ amount: 2, unit: 'handful', grams: null }, oats), { text: '100', unit: 'g' });
  assert.deepEqual(ingredientSelection({ amount: 2, unit: 'handful', grams: null }, [mm('egg', 50), mm('g', 1, 'Mass')]), { text: '1', unit: 'egg' });
  assert.deepEqual(ingredientSelection({ amount: null, unit: null, grams: null }, [mm('g', 1, 'Mass')]), { text: '100', unit: 'g' });
});

