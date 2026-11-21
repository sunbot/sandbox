import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Day, Heatmap } from '../../api/types';
import { cellText, classify, dayViews, percentOf, percentText, rowLabel, sourcesFor, summarize, weekViews } from './insights.ts';

const base = { logged: true, inProgress: false, missing: 0 };

test('goals: below target is below (finished) or in progress (today); reaching it is met', () => {
  assert.equal(classify({ ...base, amount: 10, target: 28, kind: 'Goal' }), 'below');
  assert.equal(classify({ ...base, amount: 27, target: 28, kind: 'Goal' }), 'near');
  assert.equal(classify({ ...base, amount: 27, target: 28, kind: 'Goal', inProgress: true }), 'progress');
  assert.equal(classify({ ...base, amount: 10, target: 28, kind: 'Goal', inProgress: true, dayProgress: 0.2 }), 'progress');
  assert.equal(classify({ ...base, amount: 2, target: 28, kind: 'Goal', inProgress: true, dayProgress: 0.6 }), 'behind');
  assert.equal(classify({ ...base, amount: 28, target: 28, kind: 'Goal' }), 'met');
  assert.equal(classify({ ...base, amount: 40, target: 28, kind: 'Goal', inProgress: true }), 'met');
});

test('limits: below is within, above is over; reaching a limit is never an achievement', () => {
  assert.equal(classify({ ...base, amount: 1500, target: 2300, kind: 'Limit' }), 'within');
  assert.equal(classify({ ...base, amount: 2300, target: 2300, kind: 'Limit' }), 'within');
  assert.equal(classify({ ...base, amount: 2400, target: 2300, kind: 'Limit' }), 'over');
  assert.notEqual(classify({ ...base, amount: 2400, target: 2300, kind: 'Limit' }), 'met');
});

test('missing data: never "below goal" or "within limit", but a known excess or a reached goal still counts', () => {
  assert.equal(classify({ ...base, amount: 5, target: 28, kind: 'Goal', missing: 2 }), 'incomplete');
  assert.equal(classify({ ...base, amount: 5, target: 28, kind: 'Goal', missing: 2, inProgress: true }), 'incomplete');
  assert.equal(classify({ ...base, amount: 30, target: 28, kind: 'Goal', missing: 2 }), 'met');
  assert.equal(classify({ ...base, amount: 1000, target: 2300, kind: 'Limit', missing: 1 }), 'incomplete');
  assert.equal(classify({ ...base, amount: 2500, target: 2300, kind: 'Limit', missing: 1 }), 'over');
});

test('nothing logged is its own state, not zero percent', () => {
  assert.equal(classify({ ...base, amount: 0, target: 28, kind: 'Goal', logged: false }), 'noData');
});

test('percentages', () => {
  assert.equal(percentOf(18.4, 28)!.toFixed(1), '65.7');
  assert.equal(percentOf(5, 0), null);
  assert.equal(percentText({ percent: 65.7, kind: 'Goal' }), '66% of goal');
  assert.equal(percentText({ percent: 120, kind: 'Limit' }), '120% of limit');
  assert.equal(percentText({ percent: null, kind: 'Goal' }), '–');
});

const nut = (calories: number, nutrients: Record<string, number>) => ({ calories, protein: 0, carbs: 0, fat: 0, fiber: nutrients['1079'] ?? 0, nutrients });
const entry = (name: string, nutrients: Record<string, number>) => ({ id: name, date: '2026-11-18', meal: 'Lunch' as const, item: { kind: 'Food' as const, name, quantity: 1, unit: 'g', nutrition: nut(100, nutrients) } });

const day = (entries: ReturnType<typeof entry>[], progress: Day['progress']): Day => ({
  date: '2026-11-18', totals: nut(0, {}), meals: [{ meal: 'Lunch', totals: nut(0, {}), entries }], progress,
});

test('day view: in-progress today, missing data shown as a minimum, untargeted nutrients left out', () => {
  const d = day([entry('Lentils', { '1079': 8 }), entry('Bar', {})], [
    { nutrientId: 1008, name: 'Energy', unit: 'kcal', amount: 500, target: 2000, percent: 25, kind: 'Goal', missingFrom: 0 },
    { nutrientId: 1079, name: 'Fiber', unit: 'g', amount: 8, target: 28, percent: 28.6, kind: 'Goal', missingFrom: 1 },
    { nutrientId: 1003, name: 'Protein', unit: 'g', amount: 20, target: 100, percent: 20, kind: 'Goal', missingFrom: 0 },
    { nutrientId: 9999, name: 'Untargeted', unit: 'mg', amount: 1, target: null, percent: null, kind: 'Goal', missingFrom: 0 },
  ]);
  const today = dayViews(d, true);
  assert.equal(today.length, 3);
  assert.equal(today.find((v) => v.nutrientId === 1079)!.status, 'incomplete');
  assert.equal(today.find((v) => v.nutrientId === 1003)!.status, 'progress');
  assert.equal(dayViews(d, false).find((v) => v.nutrientId === 1003)!.status, 'below');
  assert.match(rowLabel(today.find((v) => v.nutrientId === 1079)!), /at least 8 of 28 g, 29% of goal/);
});

test('an empty day shows nothing logged, not 0% deficiencies', () => {
  const d = day([], [{ nutrientId: 1079, name: 'Fiber', unit: 'g', amount: 0, target: 28, percent: 0, kind: 'Goal', missingFrom: 0 }]);
  const [v] = dayViews(d, false);
  assert.equal(v.status, 'noData');
  assert.equal(v.amount, null);
  assert.equal(v.percent, null);
  assert.match(rowLabel(v), /nothing logged/);
  assert.equal(summarize([v]).noData, true);
});

const heat = (rows: Partial<Heatmap['rows'][number]>[]): Heatmap => ({
  from: '2026-11-16', to: '2026-11-22', highlights: [],
  rows: rows.map((r) => ({ nutrientId: 1079, name: 'Fiber', unit: 'g', kind: 'Goal', target: 28, weeklyAveragePercent: 0, days: [], ...r })),
});

test('week view averages finished days only, and says nothing without any', () => {
  const [v] = weekViews(heat([{ averageAmount: 14, completedDays: 3, incompleteDays: 0 }]));
  assert.equal(v.amount, 14);
  assert.equal(v.percent, 50);
  assert.equal(v.status, 'below');
  const [none] = weekViews(heat([{ averageAmount: null, completedDays: 0 }]));
  assert.equal(none.status, 'noData');
  assert.equal(none.amount, null);
  const [partial] = weekViews(heat([{ averageAmount: 10, completedDays: 3, incompleteDays: 1 }]));
  assert.equal(partial.status, 'incomplete');
});

test('summary counts goals and limits separately and leaves calories out', () => {
  const views = weekViews(heat([
    { nutrientId: 1008, name: 'Energy', unit: 'kcal', target: 2000, averageAmount: 2100, completedDays: 3 },
    { nutrientId: 1079, averageAmount: 30, completedDays: 3 },
    { nutrientId: 1003, name: 'Protein', target: 100, averageAmount: 60, completedDays: 3 },
    { nutrientId: 1093, name: 'Sodium', unit: 'mg', kind: 'Limit', target: 2300, averageAmount: 2600, completedDays: 3 },
    { nutrientId: 1087, name: 'Calcium', unit: 'mg', target: 1000, averageAmount: 300, completedDays: 3, incompleteDays: 2 },
  ]));
  assert.deepEqual(summarize(views), { goals: 3, met: 1, open: 1, incomplete: 1, limits: 1, over: 1, noData: false });
});

test('food sources come from the saved entries; unknown values are counted, not zero', () => {
  const d = day([entry('Lentils', { '1079': 8 }), entry('Oats', { '1079': 4 }), entry('Bar', {}), entry('Water', { '1079': 0 })], []);
  const s = sourcesFor(d, 1079);
  assert.deepEqual(s.sources.map((x) => x.name), ['Lentils', 'Oats']);
  assert.equal(s.total, 12);
  assert.equal(s.unknown, 1);
  assert.equal(Math.round(s.sources[0].share * 100), 67);
});

test('heatmap cells show the number, a dash when unlogged, and ≥ when data is missing', () => {
  assert.equal(cellText({ percent: 64.6 }), '65');
  assert.equal(cellText({ percent: null }), '–');
  assert.equal(cellText({ percent: 40, missingFrom: 2 }), '≥40');
});
