import { useMemo, useState } from 'react';
import { useDay, useQuickLog, useTargets, useWeek } from '@/api/hooks';
import type { Day, DiaryEntry, Nutrition, PlanEntry } from '@/api/types';
import type { Meal } from '@/lib/format';

/**
 * Everything the Today screen shows, from the existing API hooks (no new endpoints).
 *
 * `hidden` supports Undo for deletes: an entry is hidden immediately and only deleted on the server once the
 * Undo window passes. While hidden, its nutrition is subtracted from the day's totals so the numbers on screen
 * match what you'll see after the delete commits. This is display-only; server totals are unchanged.
 */
export function useTodayData(date: string, quickMeal: Meal) {
  const day = useDay(date);
  const targets = useTargets();
  const week = useWeek(date);
  const quick = useQuickLog(quickMeal);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());

  const view = useMemo(() => {
    if (!day.data) return null;
    const hiddenEntries = day.data.meals.flatMap((m) => m.entries).filter((e) => hidden.has(e.id));
    return applyHidden(day.data, hiddenEntries, hidden);
  }, [day.data, hidden]);

  // Planned food for this date that hasn't been logged or skipped yet. Planned items never count toward totals.
  const planned = useMemo<PlanEntry[]>(() => {
    const d = week.data?.days.find((x) => x.date === date);
    return d ? d.planned.filter((p) => p.status === 'Planned') : [];
  }, [week.data, date]);

  return {
    day,
    targets,
    week,
    quick,
    view,
    planned,
    hide: (id: string) => setHidden((s) => new Set(s).add(id)),
    unhide: (id: string) => setHidden((s) => { const n = new Set(s); n.delete(id); return n; }),
    refetchAll: () => Promise.all([day.refetch(), targets.refetch(), week.refetch(), quick.refetch()]),
  };
}

function subtract(a: Nutrition, b: Nutrition): Nutrition {
  const nutrients = { ...a.nutrients };
  for (const [k, v] of Object.entries(b.nutrients)) nutrients[k] = (nutrients[k] ?? 0) - v;
  return { calories: a.calories - b.calories, protein: a.protein - b.protein, carbs: a.carbs - b.carbs, fat: a.fat - b.fat, fiber: a.fiber - b.fiber, nutrients };
}

function applyHidden(d: Day, hiddenEntries: DiaryEntry[], hidden: ReadonlySet<string>): Day {
  if (hiddenEntries.length === 0) return d;
  let totals = d.totals;
  for (const e of hiddenEntries) totals = subtract(totals, e.item.nutrition);
  const meals = d.meals.map((m) => {
    const gone = m.entries.filter((e) => hidden.has(e.id));
    let mt = m.totals;
    for (const e of gone) mt = subtract(mt, e.item.nutrition);
    return { ...m, totals: mt, entries: m.entries.filter((e) => !hidden.has(e.id)) };
  });
  const progress = d.progress.map((p) => {
    const removed = hiddenEntries.reduce((sum, e) => sum + (e.item.nutrition.nutrients[String(p.nutrientId)] ?? 0), 0);
    const amount = Math.max(0, p.amount - removed);
    return { ...p, amount, percent: p.target ? (amount / p.target) * 100 : p.percent };
  });
  return { ...d, totals, meals, progress };
}
