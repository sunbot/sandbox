/**
 * Pure rules for Nutrient Insights. No React, no network. Everything is derived from numbers the server already
 * calculated (diary totals and the weekly heatmap); nothing here changes how nutrition is computed.
 *
 * Words matter here: a goal that isn't reached yet *today* is "in progress", not low. An amount with entries that
 * don't report the nutrient is a minimum, so it is never called "below goal" or "within limit" (we don't know).
 */
import type { Day, Heatmap, NutrientProgress } from '../../api/types';

export type Kind = 'Goal' | 'Limit';

export type InsightStatus =
  | 'met'        // goal reached (known amounts alone already reach it)
  | 'near'       // finished day, complete data, 90–99% of goal (the heatmap's green band)
  | 'below'      // finished day, complete data, under 90% of goal
  | 'progress'   // today, still filling up normally
  | 'behind'     // today, well behind the share of calories already eaten
  | 'within'     // limit, complete data, not exceeded
  | 'over'       // limit exceeded (known amounts alone exceed it)
  | 'overTarget' // carbs/fat well past the target (over 110%): not an achievement
  | 'incomplete' // some entries have no value: can't say below goal / within limit
  | 'noData';    // nothing logged

export const ENERGY = 1008;
export const MACROS = new Set([1008, 1003, 1005, 1004]);
/** Targets where going well past isn't "goal met" (carbohydrate, fat): over 110% is "over target". Same as the server. */
export const OVER_TARGET_AT: Record<number, number> = { 1005: 1.1, 1004: 1.1 };

export type NutrientView = {
  nutrientId: number;
  name: string;
  unit: string;
  kind: Kind;
  /** Known amount; null when nothing is logged for the period. */
  amount: number | null;
  target: number;
  /** % of target from the known amount; null when nothing is logged. */
  percent: number | null;
  /** Entries (day) or days (week) where the nutrient was unknown. */
  missing: number;
  status: InsightStatus;
  /** Today, still under way: unfinished goals and missing data read as "in progress". */
  inProgress: boolean;
};

export function classify(input: { amount: number; target: number; kind: Kind; missing: number; logged: boolean; inProgress: boolean; dayProgress?: number; overAt?: number }): InsightStatus {
  const { amount, target, kind, missing, logged, inProgress } = input;
  if (!logged) return 'noData';
  // Known amounts alone already past the point where more isn't better: true whatever is missing.
  if (kind === 'Goal' && input.overAt && amount > target * input.overAt) return 'overTarget';
  if (kind === 'Limit') {
    if (amount > target) return 'over';
    return missing > 0 ? 'incomplete' : 'within';
  }
  if (amount >= target) return 'met';
  if (missing > 0) return 'incomplete';
  if (!inProgress) return amount / target >= 0.9 ? 'near' : 'below';
  const pace = input.dayProgress ?? 0;
  return pace >= 0.3 && amount / target < pace * 0.5 ? 'behind' : 'progress';
}

export const percentOf = (amount: number, target: number): number | null => (target > 0 ? (amount / target) * 100 : null);

/** One day's nutrients from the diary. `inProgress` for today (and never for a past day). */
export function dayViews(day: Day, inProgress: boolean): NutrientView[] {
  const logged = day.meals.some((m) => m.entries.length > 0);
  const energy = day.progress.find((p) => p.nutrientId === ENERGY);
  const dayProgress = energy?.target ? energy.amount / energy.target : 0;
  return day.progress
    .filter((p): p is NutrientProgress & { target: number } => typeof p.target === 'number' && p.target > 0)
    .map((p) => ({
      nutrientId: p.nutrientId, name: p.name, unit: p.unit, kind: p.kind, target: p.target,
      amount: logged ? p.amount : null,
      percent: logged ? percentOf(p.amount, p.target) : null,
      missing: p.missingFrom ?? 0,
      status: classify({ amount: p.amount, target: p.target, kind: p.kind, missing: p.missingFrom ?? 0, logged, inProgress, dayProgress, overAt: OVER_TARGET_AT[p.nutrientId] }),
      inProgress,
    }));
}

/** Average per finished logged day this week (today excluded). `missing` counts days with incomplete data. */
export function weekViews(h: Heatmap): NutrientView[] {
  return h.rows.map((r) => {
    const days = r.completedDays ?? 0;
    const kind = (r.kind === 'Limit' ? 'Limit' : 'Goal') as Kind;
    const amount = days > 0 ? (r.averageAmount ?? 0) : null;
    return {
      nutrientId: r.nutrientId, name: r.name, unit: r.unit, kind, target: r.target,
      amount, percent: amount == null ? null : percentOf(amount, r.target),
      missing: r.incompleteDays ?? 0,
      status: classify({ amount: amount ?? 0, target: r.target, kind, missing: r.incompleteDays ?? 0, logged: days > 0, inProgress: false, overAt: OVER_TARGET_AT[r.nutrientId] }),
      inProgress: false,
    };
  });
}

export type Summary = { goals: number; met: number; open: number; incomplete: number; limits: number; over: number; overTarget: number; noData: boolean };

/** Counts for the summary ring. Calories are left out: they have their own place on Today and Week. */
export function summarize(views: NutrientView[]): Summary {
  const s: Summary = { goals: 0, met: 0, open: 0, incomplete: 0, limits: 0, over: 0, overTarget: 0, noData: views.every((v) => v.status === 'noData') };
  for (const v of views) {
    if (v.nutrientId === ENERGY || v.status === 'noData') continue;
    if (v.kind === 'Limit') {
      s.limits += 1;
      if (v.status === 'over') s.over += 1;
      else if (v.status === 'incomplete') s.incomplete += 1;
    } else {
      s.goals += 1;
      if (v.status === 'met') s.met += 1;
      else if (v.status === 'incomplete') s.incomplete += 1;
      else if (v.status === 'overTarget') s.overTarget += 1;
      else s.open += 1;
    }
  }
  return s;
}

/** Calories and macros first, then the rest in the server's order. */
export function groupViews(views: NutrientView[]): { macros: NutrientView[]; others: NutrientView[] } {
  return { macros: views.filter((v) => MACROS.has(v.nutrientId)), others: views.filter((v) => !MACROS.has(v.nutrientId)) };
}

/* ───────── Food sources (one day) ───────── */

export type Source = { name: string; meal: string; amount: number; share: number };

/**
 * Which logged foods supplied a nutrient on one day, from each entry's saved nutrition snapshot. Entries that don't
 * report the nutrient are counted separately, never as zero. Only meaningful for a single day.
 */
export function sourcesFor(day: Day, nutrientId: number, top = 5): { sources: Source[]; unknown: number; total: number } {
  const key = String(nutrientId);
  const known: { name: string; meal: string; amount: number }[] = [];
  let unknown = 0;
  for (const m of day.meals) {
    for (const e of m.entries) {
      const v = e.item.nutrition.nutrients?.[key];
      if (typeof v === 'number') { if (v > 0) known.push({ name: e.item.name, meal: m.meal, amount: v }); }
      else unknown += 1;
    }
  }
  const total = known.reduce((a, x) => a + x.amount, 0);
  const sources = known.sort((a, b) => b.amount - a.amount).slice(0, top).map((x) => ({ ...x, share: total > 0 ? x.amount / total : 0 }));
  return { sources, unknown, total };
}

/* ───────── Words ───────── */

/**
 * The status word on a row. Missing data is explained only when the row is opened (the "≥" on the amount already
 * says it's a minimum), so collapsed rows read "In progress" today and "May be higher" on finished days.
 */
export const statusWord = (s: InsightStatus, kind: Kind, inProgress = false): string => ({
  met: 'Goal met', near: 'Nearly met', below: 'Below goal', progress: 'In progress', behind: 'Behind pace', within: 'Within limit', over: 'Over limit',
  overTarget: 'Over target', incomplete: inProgress ? 'In progress' : kind === 'Limit' ? 'May be higher' : 'May be higher', noData: 'Nothing logged',
} as const)[s];

/** "66% of goal" / "120% of limit"; whole numbers, never "NaN%". */
export const percentText = (v: Pick<NutrientView, 'percent' | 'kind'>) => (v.percent == null ? '–' : `${Math.round(v.percent)}% of ${v.kind === 'Limit' ? 'limit' : 'goal'}`);

/** One decimal under 10, whole numbers above; never "0.0". */
export const amountText = (n: number) => (n === 0 ? '0' : n >= 10 ? Math.round(n).toLocaleString('en-US') : n.toFixed(1).replace(/\.0$/, ''));

/** Spoken summary of a row, with the same facts as the visual. */
export function rowLabel(v: NutrientView): string {
  if (v.amount == null) return `${v.name}: nothing logged. ${v.kind === 'Limit' ? 'Limit' : 'Goal'} ${amountText(v.target)} ${v.unit}.`;
  const min = v.missing > 0 ? 'at least ' : '';
  const note = v.status === 'incomplete' ? ' Some entries have no value for it, so the real amount may be higher.' : '';
  return `${v.name}: ${min}${amountText(v.amount)} of ${amountText(v.target)} ${v.unit}, ${percentText(v)}. ${statusWord(v.status, v.kind, v.inProgress)}.${note}`;
}

/* ───────── Heatmap helpers ───────── */

/** Cell text: the % (never colour alone), "–" for an unlogged day, and a "≥" when the amount is a minimum. */
export const cellText = (c: { percent?: number | null; missingFrom?: number }) => (c.percent == null ? '–' : `${(c.missingFrom ?? 0) > 0 ? '≥' : ''}${Math.round(c.percent)}`);

export const loggedDayCount = (h: Heatmap) => (h.rows[0]?.days ?? []).filter((d) => d.percent != null).length;
