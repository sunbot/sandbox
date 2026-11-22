import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Item, Measure } from '../../api/types.ts';
import { checkQuantity, convert, formatQuantity, initialSelection, matchMeasure, measureText, measuresForItem, parseQuantity, scaleFactor, SERVING, volumeNote } from './quantity.ts';

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
