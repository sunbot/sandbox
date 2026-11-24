import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BudgetPreview } from '../../api/types';
import { exampleText, rangeText } from './budgetPreview.ts';

const p = (over: Partial<BudgetPreview> = {}): BudgetPreview => ({
  baseTarget: 1400, minTarget: 1190, maxTarget: 1610, todayTarget: 1400, extraKcal: 300, daysAfterToday: 4,
  nextDaysTarget: 1325, capReached: false, unabsorbedCarryover: 0, ...over,
});

test('range shows the concrete limits for each percentage', () => {
  assert.equal(rangeText(p({ minTarget: 1260, maxTarget: 1540 }), 10), 'With a 1,400 kcal base target, ±10% permits 1,260–1,540 kcal/day.');
  assert.equal(rangeText(p(), 15), 'With a 1,400 kcal base target, ±15% permits 1,190–1,610 kcal/day.');
  assert.equal(rangeText(p({ minTarget: 1050, maxTarget: 1750 }), 25), 'With a 1,400 kcal base target, ±25% permits 1,050–1,750 kcal/day.');
});

test('example describes the following days and says approximately', () => {
  assert.equal(exampleText(p()), 'If today ends 300 kcal above its 1,400 kcal target, the 4 days after today would be about 1,325 kcal each.');
  assert.match(exampleText(p({ daysAfterToday: 1 }))!, /tomorrow would be/);
});

test('example flags cap saturation and handles under-eating', () => {
  assert.match(exampleText(p({ capReached: true, unabsorbedCarryover: -1800 }))!, /hits the daily limit.*1,800 kcal isn't made up/);
  assert.match(exampleText(p({ extraKcal: -200 }))!, /200 kcal below/);
});

test('no example without following days or in daily mode', () => {
  assert.equal(exampleText(p({ nextDaysTarget: null })), null);
  assert.equal(exampleText(p({ daysAfterToday: 0 })), null);
});
