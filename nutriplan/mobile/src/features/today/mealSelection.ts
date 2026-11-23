import type { Meal } from '../../lib/format';

/** Which entries of one meal are ticked in "Select entries" mode. */
export type MealSelection = { meal: Meal; ids: string[] };

export const startSelection = (meal: Meal): MealSelection => ({ meal, ids: [] });

export function toggleSelected(sel: MealSelection, id: string): MealSelection {
  return { ...sel, ids: sel.ids.includes(id) ? sel.ids.filter((x) => x !== id) : [...sel.ids, id] };
}

/** Selecting all ticks every entry of the meal; when all are ticked already it clears them. */
export function toggleAll(sel: MealSelection, entryIds: string[]): MealSelection {
  return { ...sel, ids: allSelected(sel, entryIds) ? [] : [...entryIds] };
}

export const allSelected = (sel: MealSelection, entryIds: string[]) => entryIds.length > 0 && entryIds.every((id) => sel.ids.includes(id));

/** Only ids still shown in the meal count (entries deleted or moved elsewhere drop out of the selection). */
export const liveSelection = (sel: MealSelection, entryIds: string[]): string[] => entryIds.filter((id) => sel.ids.includes(id));

/** Move can go to any other meal. */
export const moveTargets = (all: Meal[], from: Meal): Meal[] => all.filter((m) => m !== from);

export const countText = (n: number) => `${n} ${n === 1 ? 'entry' : 'entries'}`;
export const selectedText = (n: number) => (n === 0 ? 'None selected' : `${n} selected`);
