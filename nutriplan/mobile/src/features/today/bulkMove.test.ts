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

test('a meal checkbox ticks all its entries, shows "some" when partly ticked, and keeps other meals (#85)', async () => {
  const { mealSelection, toggleMeal } = await import('./bulkMove.ts');
  const dinner = [{ id: 'd1' }, { id: 'd2' }, { id: 'd3' }];
  let sel = toggleMeal(dinner, new Set(['l1']));                 // lunch item already ticked
  assert.equal(mealSelection(dinner, sel), 'all');
  assert.ok(sel.has('l1'), 'the other meal keeps its selection');
  sel.delete('d2');
  assert.equal(mealSelection(dinner, sel), 'some');
  sel = toggleMeal(dinner, sel);                                 // some → all
  assert.equal(mealSelection(dinner, sel), 'all');
  sel = toggleMeal(dinner, sel);                                 // all → none
  assert.equal(mealSelection(dinner, sel), 'none');
  assert.deepEqual([...sel], ['l1']);
});

test('moving to another day is never a no-op, and Undo then sends every entry back', async () => {
  const { isNoOpMove, undoGroups } = await import('./bulkMove.ts');
  const e = (id: string, meal: 'Breakfast' | 'Dinner') => ({ id, meal }) as never;
  const sel = [e('a', 'Dinner'), e('b', 'Dinner')];
  assert.equal(isNoOpMove(sel, 'Dinner', '2026-11-24', '2026-11-24'), true);
  assert.equal(isNoOpMove(sel, 'Dinner', '2026-11-25', '2026-11-24'), false);
  assert.deepEqual(undoGroups(sel, 'Dinner', true), [{ meal: 'Dinner', entryIds: ['a', 'b'] }]);
  assert.deepEqual(undoGroups(sel, 'Dinner'), []);
});
