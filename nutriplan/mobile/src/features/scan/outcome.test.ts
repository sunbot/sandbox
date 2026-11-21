import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scanFailure } from './outcome.ts';

const err = (status: number, message = 'x', reason?: string) => Object.assign(new Error(message), { status, reason });

test('only a genuine not-found goes to manual entry', () => {
  assert.equal(scanFailure(err(404, 'not found', 'NotFound')).kind, 'notFound');
  assert.equal(scanFailure(err(404)).kind, 'notFound'); // older server without a reason
});

test('temporary failures offer a retry, never straight to manual entry', () => {
  for (const reason of ['Timeout', 'RateLimited', 'Network', 'BadResponse']) {
    const f = scanFailure(err(503, 'The product database took too long to answer.', reason));
    assert.equal(f.kind, 'retry');
    assert.match(f.message, /took too long/);
  }
  assert.equal(scanFailure(err(0, 'offline')).kind, 'retry');
  assert.match(scanFailure(err(0, 'offline')).message, /Can’t reach the server/);
  assert.equal(scanFailure(err(500, 'boom')).kind, 'retry');
  assert.equal(scanFailure(new Error('weird')).kind, 'retry');
});

test('an invalid barcode resumes scanning; a missing key points to Settings', () => {
  assert.equal(scanFailure(err(400, 'That doesn’t look like a product barcode.')).kind, 'invalid');
  assert.equal(scanFailure(err(401, 'API key missing')).kind, 'settings');
});
