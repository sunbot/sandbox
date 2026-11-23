import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pendingKind, pendingLabel } from './loading.ts';

test('recipe requests are not shown as food lookups', () => {
  for (const t of ['I would really like a margarita pizza recipe', 'margherita pizza recipe', 'give me a pizza recipe']) {
    assert.equal(pendingKind(t), 'recipes');
    assert.equal(pendingLabel(t), 'Looking for recipes…');
  }
});

test('logging, planning and nutrition questions get their own copy', () => {
  assert.equal(pendingLabel('I ate pizza'), 'Finding foods…');
  assert.equal(pendingLabel('plan salmon for friday dinner'), 'Planning that…');
  assert.equal(pendingLabel('how much protein do I still need'), 'Checking your numbers…');
});

test('unknown intent gets neutral copy', () => {
  assert.equal(pendingLabel('a margarita'), 'Looking into that…');
});
