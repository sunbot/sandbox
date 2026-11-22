import assert from 'node:assert/strict';
import { test } from 'node:test';
import { steadyHeightFor } from './steadyHeight.ts';

test('the sheet keeps the height measured for the same key (#52)', () => {
  assert.equal(steadyHeightFor({ key: 'e1:editor', height: 420 }, 'e1:editor'), 420);
});

test('a new key (another entry, or another view of it) is measured again', () => {
  assert.equal(steadyHeightFor({ key: 'e1:nutrition', height: 300 }, 'e1:editor'), undefined);
  assert.equal(steadyHeightFor({ key: 'e1:editor', height: 420 }, 'e2:editor'), undefined);
  assert.equal(steadyHeightFor(null, 'e1:editor'), undefined);
});

test('a zero height (laid out while hidden) is never locked in', () => {
  assert.equal(steadyHeightFor({ key: 'k', height: 0 }, 'k'), undefined);
});
