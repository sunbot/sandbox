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

/** True when every selected entry is already in that meal (or nothing is selected). */
export const isNoOpMove = (selected: DiaryEntry[], to: Meal) => selected.every((e) => e.meal === to);

/** For Undo: the entries to send back to each meal they came from (only the ones that actually moved). */
export function undoGroups(selected: DiaryEntry[], to: Meal): { meal: Meal; entryIds: string[] }[] {
  const groups = new Map<Meal, string[]>();
  for (const e of selected) if (e.meal !== to) (groups.get(e.meal) ?? groups.set(e.meal, []).get(e.meal)!).push(e.id);
  return ORDER.filter((m) => groups.has(m)).map((m) => ({ meal: m, entryIds: groups.get(m)! }));
}

/** "breakfast", "snacks": how a meal reads inside a sentence. */
export const mealInSentence = (m: Meal) => (m === 'Snack' ? 'snacks' : m.toLowerCase());
