import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchDetail, recipeTrust, trustLines } from './nutritionView.ts';

const nut = (calories: number, ids: number[]) => ({ calories, protein: 0, carbs: 0, fat: 0, fiber: 0, nutrients: Object.fromEntries(ids.map((i) => [String(i), 1])) });
const ALL = [1079, 2000, 1235, 1258, 1093, 1114, 1190, 1178];

test('coverage, confidence and completeness are measured separately', () => {
  const t = recipeTrust([
    { status: 'AutoMatched', note: null, grams: 400, matchConfidence: 1, nutrition: nut(750, ALL.filter((i) => i !== 1235)) },      // coconut milk: sure
    { status: 'AutoMatched', note: null, grams: 100, matchConfidence: 0.45, nutrition: nut(250, ALL.filter((i) => i !== 1114 && i !== 1235)) }, // weak match
    { status: 'Unmatched', note: null, grams: null, matchConfidence: 0, nutrition: null },
    { status: 'Ignored', note: 'Section header', grams: null, matchConfidence: 0, nutrition: null },
  ]);
  assert.deepEqual(t.coverage, { counted: 2, total: 3, percent: 67 });
  assert.deepEqual(t.confidence, { percent: 75, toCheck: 1 });                     // 750 of 1000 kcal from confident matches
  assert.equal(t.completeness.complete, 6);
  assert.deepEqual(t.completeness.partial, [{ name: 'added sugars', percent: 0 }, { name: 'vitamin D', percent: 80 }]);
});

test('100% matched is not called verified: a confident line list still shows nutrient gaps', () => {
  const lines = trustLines(recipeTrust([{ status: 'Confirmed', note: null, grams: 100, matchConfidence: 0.2, nutrition: nut(100, [1079]) }]));
  assert.equal(lines[0].value, '1 of 1');
  assert.equal(lines[1].value, '100% of calories from confirmed or close matches');
  assert.equal(lines[1].weak, false);
  assert.match(lines[2].detail!, /sodium 0%/);
  assert.equal(lines[2].weak, true);
});

test('nothing counted: no confidence or completeness claims', () => {
  const lines = trustLines(recipeTrust([{ status: 'Unmatched', note: null, grams: null, matchConfidence: 0, nutrition: null }]));
  assert.deepEqual(lines.map((l) => l.label), ['Ingredients counted']);
});

test('the ingredient sheet says where the numbers come from and how sure the match is', () => {
  assert.equal(matchDetail({ status: 'AutoMatched', matchConfidence: 0.92, foodSource: 'UsdaSrLegacy' }), 'USDA SR Legacy · close match (92%)');
  assert.equal(matchDetail({ status: 'AutoMatched', matchConfidence: 0.4, foodSource: 'UsdaSurvey' }), 'USDA FNDDS (food as eaten, often cooked) · weak match (40%)');
  assert.equal(matchDetail({ status: 'Confirmed', matchConfidence: 0.3, foodSource: 'User' }), 'Your food · confirmed by you');
  assert.equal(matchDetail({ status: 'Unmatched', matchConfidence: 0, foodSource: null }), null);
});
