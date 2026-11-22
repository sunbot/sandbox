import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createOpenRowTracker } from './openRow.ts';

test('only one row stays open: opening another closes the first', () => {
  const closed: string[] = [];
  const t = createOpenRowTracker<string>((r) => closed.push(r));
  t.opened('a');
  t.opened('b');
  assert.deepEqual(closed, ['a']);
  assert.equal(t.current(), 'b');
});

test('a tap or a scroll closes the open row once, and reports whether there was one', () => {
  const closed: string[] = [];
  const t = createOpenRowTracker<string>((r) => closed.push(r));
  assert.equal(t.closeOpen(), false); // nothing open: the tap goes through to the row
  t.opened('a');
  assert.equal(t.closeOpen(), true);  // something open: the tap only closes it
  assert.equal(t.closeOpen(), false);
  assert.deepEqual(closed, ['a']);
});

test('a row that closes itself (swiped back, or deleted) is forgotten', () => {
  const closed: string[] = [];
  const t = createOpenRowTracker<string>((r) => closed.push(r));
  t.opened('a');
  t.forget('a');
  assert.equal(t.current(), null);
  t.forget('b'); // forgetting a row that isn't open changes nothing
  t.opened('b');
  assert.equal(t.closeOpen(), true);
  assert.deepEqual(closed, ['b']);
});

test('re-opening the same row does not close it', () => {
  const closed: string[] = [];
  const t = createOpenRowTracker<string>((r) => closed.push(r));
  t.opened('a');
  t.opened('a');
  assert.deepEqual(closed, []);
});
