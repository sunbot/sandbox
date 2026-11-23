import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allSelected, countText, liveSelection, moveTargets, selectedText, startSelection, toggleAll, toggleSelected } from './mealSelection.ts';

test('selection starts empty and toggles entries on and off', () => {
  let s = startSelection('Dinner');
  assert.deepEqual(s.ids, []);
  s = toggleSelected(s, 'a');
  s = toggleSelected(s, 'b');
  assert.deepEqual(s.ids, ['a', 'b']);
  s = toggleSelected(s, 'a');
  assert.deepEqual(s.ids, ['b']);
  assert.equal(s.meal, 'Dinner');
});

test('select all ticks the whole meal, and again clears it', () => {
  const ids = ['a', 'b', 'c'];
  let s = toggleAll(startSelection('Lunch'), ids);
  assert.ok(allSelected(s, ids));
  s = toggleAll(s, ids);
  assert.deepEqual(s.ids, []);
  assert.equal(allSelected(s, []), false);
});

test('entries that disappeared drop out of the selection', () => {
  const s = { meal: 'Lunch' as const, ids: ['a', 'gone', 'c'] };
  assert.deepEqual(liveSelection(s, ['a', 'b', 'c']), ['a', 'c']);
});

test('move targets exclude the source meal', () => {
  const t = moveTargets(['Breakfast', 'Lunch', 'Dinner', 'Snack'], 'Dinner');
  assert.equal(t.includes('Dinner'), false);
  assert.equal(t.length, 3);
});

test('count wording', () => {
  assert.equal(countText(1), '1 entry');
  assert.equal(countText(3), '3 entries');
  assert.equal(selectedText(0), 'None selected');
  assert.equal(selectedText(2), '2 selected');
});
