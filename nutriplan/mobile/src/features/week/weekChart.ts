/**
 * Pure numbers behind the Week chart and summary. Everything comes from the server's week (its weekly budgeting is
 * not recalculated here): eaten = diary entries, planned = plan entries still marked Planned (never counted as eaten),
 * target = each day's adjusted target. Days are in the server's order, so a configured week start is respected.
 */
import type { PlanDay, Week } from '../../api/types';

export type WeekSummary = {
  target: number;
  eaten: number;
  /** Still planned, not yet eaten (today and later). */
  planned: number;
  /** Eaten + planned: where the week lands if you follow the plan. */
  projected: number;
  /** Target − projected: room no meal is planned for yet (negative = over target if you follow the plan). */
  capacity: number;
};

export function weekSummary(w: Pick<Week, 'weeklyCalorieTarget' | 'eatenSoFar' | 'projectedTotal'>): WeekSummary {
  const planned = Math.max(0, w.projectedTotal - w.eatenSoFar);
  return { target: w.weeklyCalorieTarget, eaten: w.eatenSoFar, planned, projected: w.projectedTotal, capacity: w.weeklyCalorieTarget - w.projectedTotal };
}

export type ChartDay = {
  date: string;
  eaten: number;
  planned: number;
  target: number;
  adjusted: boolean;
  isToday: boolean;
  isPast: boolean;
  untracked: boolean;
  /** eaten + planned − target (positive = over target). */
  overBy: number;
};

export function chartDays(w: Pick<Week, 'days'>): ChartDay[] {
  return w.days.map((d) => {
    const eaten = Math.max(0, d.eaten.calories);
    const planned = d.isPast ? 0 : Math.max(0, d.plannedRemaining.calories);
    const target = Math.max(0, d.adjustedCalorieTarget);
    return {
      date: d.date, eaten, planned, target,
      adjusted: Math.round(d.adjustedCalorieTarget) !== Math.round(d.baseCalorieTarget),
      isToday: d.isToday, isPast: d.isPast, untracked: d.isUntracked,
      overBy: eaten + planned - target,
    };
  });
}

/** The value at the top of the chart: the largest bar or target, with a little headroom; never 0. */
export function chartMax(days: ChartDay[]): number {
  const m = Math.max(0, ...days.map((d) => Math.max(d.target, d.eaten + d.planned)));
  return m > 0 ? m * 1.08 : 1;
}

/** Fraction (0–1) of the chart height. */
export const frac = (n: number, max: number) => Math.max(0, Math.min(1, max > 0 ? n / max : 0));

/** Today when it's in this week, otherwise nothing selected. */
export const defaultDay = (days: Pick<ChartDay, 'date' | 'isToday'>[]) => days.find((d) => d.isToday)?.date ?? null;

const k = (n: number) => Math.round(n).toLocaleString('en-US');

/** One line about a day, in the same words as the rest of the app. */
export function dayStatus(d: ChartDay): string {
  if (d.isPast) return d.untracked ? 'Nothing logged' : d.overBy > 0 ? `Ate ${k(d.eaten)} kcal, ${k(d.overBy)} over target` : `Ate ${k(d.eaten)} kcal`;
  if (d.overBy > 0) return `${k(d.overBy)} kcal over target`;
  return `${k(-d.overBy)} kcal not planned yet`;
}

/** Exact numbers for a day, spoken and shown when it's selected. */
export function dayDetail(d: ChartDay): { label: string; value: string }[] {
  const rows = [
    { label: 'Eaten', value: `${k(d.eaten)} kcal` },
    ...(d.isPast ? [] : [{ label: 'Still planned', value: `${k(d.planned)} kcal` }]),
    { label: d.adjusted ? 'Target (adjusted)' : 'Target', value: `${k(d.target)} kcal` },
  ];
  return rows;
}

export const dayLabel = (d: ChartDay, weekday: string) => `${d.isToday ? 'Today' : weekday}: ${dayDetail(d).map((r) => `${r.label} ${r.value}`).join(', ')}. ${dayStatus(d)}.`;

/** Whether today and the week disagree on what was eaten (they must not: both read the same diary). */
export const sameEaten = (todayTotal: number, weekDay: Pick<PlanDay, 'eaten'>) => Math.abs(todayTotal - weekDay.eaten.calories) < 0.5;
