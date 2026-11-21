/** Date handling around time-zone and month/year/DST boundaries: dates are local calendar days, never UTC instants. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addDays, fromIsoDate, toIsoDate } from './format.ts';

function inZone<T>(zone: string, fn: () => T): T {
  const before = process.env.TZ;
  process.env.TZ = zone;
  try { return fn(); } finally { if (before === undefined) delete process.env.TZ; else process.env.TZ = before; }
}

for (const zone of ['Pacific/Auckland', 'America/Los_Angeles', 'UTC', 'Asia/Kolkata']) {
  test(`late evening stays on the same calendar day in ${zone}`, () => {
    inZone(zone, () => {
      assert.equal(toIsoDate(new Date(2026, 10, 21, 23, 59, 59)), '2026-11-21');
      assert.equal(toIsoDate(new Date(2026, 10, 22, 0, 0, 1)), '2026-11-22');
    });
  });

  test(`ISO date round-trips in ${zone}`, () => {
    inZone(zone, () => assert.equal(toIsoDate(fromIsoDate('2026-03-08')), '2026-03-08'));
  });
}

test('adding days crosses month, year and DST changes without skipping or repeating a day', () => {
  inZone('America/Los_Angeles', () => {
    assert.equal(addDays('2026-11-30', 1), '2026-12-01');
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(addDays('2026-03-07', 1), '2026-03-08'); // US spring-forward day
    assert.equal(addDays('2026-03-08', 1), '2026-03-09');
    assert.equal(addDays('2026-11-01', 1), '2026-11-02'); // fall-back day
    assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  });
});
