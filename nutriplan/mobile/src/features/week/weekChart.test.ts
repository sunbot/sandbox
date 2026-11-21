import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Nutrition, PlanDay, Week } from '../../api/types';
import { chartDays, chartMax, dayDetail, dayStatus, defaultDay, frac, sameEaten, weekSummary } from './weekChart.ts';

const n = (calories: number): Nutrition => ({ calories, protein: 0, carbs: 0, fat: 0, fiber: 0, nutrients: {} });
const day = (date: string, over: Partial<PlanDay> & { eatenKcal?: number; plannedKcal?: number } = {}): PlanDay => ({
  date, isPast: false, isToday: false, isUntracked: false, baseCalorieTarget: 2000, adjustedCalorieTarget: 2000,
  eaten: n(over.eatenKcal ?? 0), plannedRemaining: n(over.plannedKcal ?? 0), projected: n((over.eatenKcal ?? 0) + (over.plannedKcal ?? 0)),
  planned: [], logged: [], ...over,
});
const week = (days: PlanDay[], extra: Partial<Week> = {}): Week => ({
  weekStart: days[0].date, weekEnd: days[days.length - 1].date, budgetMode: 'Weekly', weeklyCalorieTarget: 14000,
  eatenSoFar: days.reduce((a, d) => a + d.eaten.calories, 0), projectedTotal: days.reduce((a, d) => a + d.projected.calories, 0),
  unabsorbedCarryover: 0, dailyTargets: n(2000), days, ...extra,
});

test('summary separates eaten, still planned, projected and remaining capacity', () => {
  const s = weekSummary({ weeklyCalorieTarget: 14000, eatenSoFar: 5200, projectedTotal: 12100 });
  assert.deepEqual(s, { target: 14000, eaten: 5200, planned: 6900, projected: 12100, capacity: 1900 });
  assert.equal(weekSummary({ weeklyCalorieTarget: 14000, eatenSoFar: 9000, projectedTotal: 15000 }).capacity, -1000); // over if you follow the plan
  assert.equal(weekSummary({ weeklyCalorieTarget: 14000, eatenSoFar: 3000, projectedTotal: 2800 }).planned, 0);         // never negative
});

test('planned food never counts as eaten, and a past day has nothing still planned', () => {
  const d = chartDays(week([day('2026-11-16', { isPast: true, eatenKcal: 1800, plannedKcal: 500 }), day('2026-11-17', { isToday: true, eatenKcal: 900, plannedKcal: 700 })]));
  assert.equal(d[0].eaten, 1800);
  assert.equal(d[0].planned, 0);
  assert.equal(d[1].eaten, 900);
  assert.equal(d[1].planned, 700);
});

test('days follow the server order, so the configured week start is respected', () => {
  const sunStart = ['2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21'];
  assert.deepEqual(chartDays(week(sunStart.map((x) => day(x)))).map((x) => x.date), sunStart);
});

test('over-target days say by how much; days under say what is not planned yet', () => {
  const [past, over, under] = chartDays(week([
    day('2026-11-16', { isPast: true, eatenKcal: 2300 }),
    day('2026-11-17', { isToday: true, eatenKcal: 1500, plannedKcal: 800 }),
    day('2026-11-18', { plannedKcal: 1600, adjustedCalorieTarget: 1900 }),
  ]));
  assert.equal(dayStatus(past), 'Ate 2,300 kcal, 300 over target');
  assert.equal(dayStatus(over), '300 kcal over target');
  assert.equal(dayStatus(under), '300 kcal not planned yet');
  assert.equal(under.adjusted, true);
  assert.deepEqual(dayDetail(under).map((r) => r.label), ['Eaten', 'Still planned', 'Target (adjusted)']);
  assert.deepEqual(dayDetail(past).map((r) => r.label), ['Eaten', 'Target']);
});

test('empty days and a partial week', () => {
  const days = chartDays(week([day('2026-11-16', { isPast: true, isUntracked: true }), day('2026-11-17', { isToday: true }), day('2026-11-18')]));
  assert.equal(dayStatus(days[0]), 'Nothing logged');
  assert.equal(dayStatus(days[1]), '2,000 kcal not planned yet');
  assert.equal(chartMax(days), 2000 * 1.08);
  assert.equal(chartMax(chartDays(week([day('2026-11-16', { adjustedCalorieTarget: 0, baseCalorieTarget: 0 })]))), 1); // never divide by 0
});

test('bar heights scale to the largest bar or target and are clamped', () => {
  const days = chartDays(week([day('2026-11-16', { eatenKcal: 2600 }), day('2026-11-17', { eatenKcal: 1000 })]));
  const max = chartMax(days);
  assert.equal(max, 2600 * 1.08);
  assert.ok(frac(2600, max) < 1);
  assert.equal(frac(-5, max), 0);
  assert.equal(frac(99999, max), 1);
  assert.equal(frac(5, 0), 0);
});

test('today is selected by default only when it is in the week', () => {
  assert.equal(defaultDay([{ date: 'a', isToday: false }, { date: 'b', isToday: true }]), 'b');
  assert.equal(defaultDay([{ date: 'a', isToday: false }]), null);
});

test('Today and Week read the same eaten total', () => {
  assert.equal(sameEaten(1234.4, { eaten: n(1234) }), true);
  assert.equal(sameEaten(1300, { eaten: n(1234) }), false);
});
