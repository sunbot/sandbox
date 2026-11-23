import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DiaryEntry } from '../../api/types';
import type { Meal } from '../../lib/format';
import { defaultDestination, isNoOpMove, liveSelection, mealInSentence, undoGroups } from './bulkMove.ts';

const e = (id: string, meal: Meal): DiaryEntry => ({ id, date: '2026-11-23', meal, item: { kind: 'Food', name: id, quantity: 1, unit: 'g', nutrition: { calories: 1, protein: 0, carbs: 0, fat: 0, fiber: 0, nutrients: {} } } });

test('only entries still on the day count as selected', () => {
  const day = [e('a', 'Breakfast'), e('b', 'Lunch')];
  assert.deepEqual(liveSelection(new Set(['a', 'gone']), day).map((x) => x.id), ['a']);
});

test('the default destination never moves everything to where it already is', () => {
  assert.equal(defaultDestination([e('a', 'Breakfast')], 'Lunch'), 'Lunch');            // time of day, when that's a real move
  assert.equal(defaultDestination([e('a', 'Breakfast')], 'Breakfast'), 'Lunch');        // all already there: next meal
  assert.equal(defaultDestination([e('a', 'Breakfast'), e('b', 'Lunch')], 'Breakfast'), 'Breakfast'); // mixed: Breakfast moves b
  assert.ok(isNoOpMove([e('a', 'Dinner'), e('b', 'Dinner')], 'Dinner'));
  assert.ok(!isNoOpMove([e('a', 'Dinner'), e('b', 'Lunch')], 'Dinner'));
});

test('undo sends each moved entry back to its own meal, skipping ones that were already there', () => {
  const sel = [e('a', 'Lunch'), e('b', 'Breakfast'), e('c', 'Dinner'), e('d', 'Lunch')];
  assert.deepEqual(undoGroups(sel, 'Dinner'), [{ meal: 'Breakfast', entryIds: ['b'] }, { meal: 'Lunch', entryIds: ['a', 'd'] }]);
});

test('meals read naturally in a sentence', () => {
  assert.equal(mealInSentence('Snack'), 'snacks');
  assert.equal(mealInSentence('Dinner'), 'dinner');
});
