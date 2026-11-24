/**
 * Rules for moving several diary entries to another meal (pure, tested). The server moves them in one save; these decide
 * what the app offers: which entries are really selected, where to move by default, when a move would do nothing, and how
 * to undo it (each entry back to the meal it came from).
 */
import type { DiaryEntry } from '../../api/types';
import type { Meal } from '../../lib/format';

const ORDER: Meal[] = ['Breakfast', 'Lunch', 'Dinner', 'Snack'];

/** The selected entries that still exist on the day (one deleted elsewhere or refreshed away drops out). */
export function liveSelection(selected: ReadonlySet<string>, entries: DiaryEntry[]): DiaryEntry[] {
  return entries.filter((e) => selected.has(e.id));
}

/**
 * Where the move sheet starts: the preferred meal (the time of day), unless every selected entry is already there; then the
 * first meal they aren't all in, so the main button never offers a move that changes nothing.
 */
export function defaultDestination(selected: DiaryEntry[], preferred: Meal): Meal {
  if (!isNoOpMove(selected, preferred)) return preferred;
  return ORDER.find((m) => !isNoOpMove(selected, m)) ?? preferred;
}

/** True when every selected entry is already in that meal on that day (or nothing is selected). Another day is always a move. */
export const isNoOpMove = (selected: DiaryEntry[], to: Meal, toDate?: string, fromDate?: string) =>
  (toDate === undefined || toDate === fromDate) && selected.every((e) => e.meal === to);

/** For Undo: the entries to send back to each meal they came from (only the ones that actually moved). */
export function undoGroups(selected: DiaryEntry[], to: Meal, otherDay = false): { meal: Meal; entryIds: string[] }[] {
  const groups = new Map<Meal, string[]>();
  for (const e of selected) if (otherDay || e.meal !== to) (groups.get(e.meal) ?? groups.set(e.meal, []).get(e.meal)!).push(e.id);
  return ORDER.filter((m) => groups.has(m)).map((m) => ({ meal: m, entryIds: groups.get(m)! }));
}

/** "breakfast", "snacks": how a meal reads inside a sentence. */
export const mealInSentence = (m: Meal) => (m === 'Snack' ? 'snacks' : m.toLowerCase());

/** A meal's heading checkbox while selecting: all of its entries ticked, some, or none (#85). */
export function mealSelection(entries: Pick<DiaryEntry, 'id'>[], selected: ReadonlySet<string>): 'all' | 'some' | 'none' {
  const n = entries.filter((e) => selected.has(e.id)).length;
  return n === 0 ? 'none' : n === entries.length ? 'all' : 'some';
}

/** Tapping a meal's checkbox: ticks all of its entries, or clears them when all are ticked. Other meals keep their ticks. */
export function toggleMeal(entries: Pick<DiaryEntry, 'id'>[], selected: ReadonlySet<string>): Set<string> {
  const next = new Set(selected);
  const all = mealSelection(entries, selected) === 'all';
  for (const e of entries) { if (all) next.delete(e.id); else next.add(e.id); }
  return next;
}

/** Day choices in the move sheet, relative to the day being viewed. */
export function dayChoices(viewed: string, addDays: (d: string, n: number) => string): { label: string; date: string }[] {
  return [
    { label: 'Yesterday', date: addDays(viewed, -1) }, { label: 'Same day', date: viewed }, { label: 'Tomorrow', date: addDays(viewed, 1) },
  ];
}
