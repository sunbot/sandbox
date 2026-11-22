import type { GapEffect, GapItem, GapMode, GapReport } from '@/api/types';

/** Pure view logic for Fill the Gaps (kept out of the route so it can be tested). */

export const MODE_LABEL: Record<GapMode, string> = {
  BestMatch: 'Best match',
  Meal: 'Meal',
  QuickSnack: 'Quick snack',
  Pantry: 'Pantry',
  SavedRecipes: 'Saved recipes',
};

const MODE_ORDER: GapMode[] = ['BestMatch', 'Meal', 'QuickSnack', 'Pantry', 'SavedRecipes'];

/** Whole number with thousands separators (locale-independent). */
export function fmtInt(n: number): string {
  return String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** One decimal under 10, none above; never "-0". */
export function fmtAmount(n: number): string {
  const v = Math.abs(n);
  return v >= 10 ? String(Math.round(v)) : String(Math.round(v * 10) / 10);
}

/** The filter chips to show: only modes that lead somewhere, plus the one the user picked (so it never silently vanishes). */
export function modeChips(available: { mode: GapMode; count: number }[], selected: GapMode): GapMode[] {
  const shown = new Set<GapMode>(available.filter((m) => m.count > 0).map((m) => m.mode));
  shown.add(selected);
  if (shown.size > 1 || selected !== 'BestMatch') shown.add('BestMatch');
  return MODE_ORDER.filter((m) => shown.has(m));
}

/** "1,214 kcal over", "420 kcal left" or "On target". The overage is stated, never clamped to zero. */
export function calorieHeadline(kcal: number, situation: GapReport['situation']): { text: string; over: boolean } {
  if (situation === 'Over') return { text: `${fmtInt(kcal)} kcal over`, over: true };
  if (situation === 'AtTarget') return { text: kcal < 0 ? `${fmtInt(kcal)} kcal over` : 'On target', over: kcal < 0 };
  return { text: `${fmtInt(kcal)} kcal left`, over: false };
}

/** A macro as "32 g left" or "12 g over". */
export function macroText(n: number, unit = 'g'): { text: string; over: boolean } {
  return n < -0.5 ? { text: `${fmtAmount(n)} ${unit} over`, over: true } : { text: `${fmtAmount(Math.max(0, n))} ${unit} left`, over: false };
}

/** What a suggestion does to a nutrient, in words. */
export function effectLine(e: GapEffect): string {
  if (e.kind === 'Limit') return `${e.name}: ${fmtAmount(e.before)} → ${fmtAmount(e.after)} ${e.unit} room left`;
  return e.after <= 0.05
    ? `${e.name}: ${fmtAmount(e.before)} ${e.unit} short → covered`
    : `${e.name}: ${fmtAmount(e.before)} → ${fmtAmount(e.after)} ${e.unit} short`;
}

/** The API calls a suggestion's items need: foods go in one all-or-nothing request, recipes one by one. */
export function planPayload(items: Pick<GapItem, 'foodId' | 'recipeId' | 'amount'>[]): { foods: { foodId: string; grams: number }[]; recipes: { recipeId: string; servings: number }[] } {
  return {
    foods: items.filter((i) => i.foodId && !i.recipeId).map((i) => ({ foodId: i.foodId!, grams: i.amount })),
    recipes: items.filter((i) => i.recipeId).map((i) => ({ recipeId: i.recipeId!, servings: i.amount })),
  };
}

export const itemsTitle = (items: GapItem[]) => items.map((i) => i.name).join(' + ');

/** A stable id for a suggestion (its foods/recipes and amounts), so "Planned" follows the suggestion, not its position in the list. */
export const suggestionId = (items: Pick<GapItem, 'foodId' | 'recipeId' | 'amount'>[]) => items.map((i) => `${i.foodId ?? i.recipeId}:${i.amount}`).join('|');

const ORIGIN_BADGE: Record<string, string> = { favorite: 'Favorite', recipe: 'Saved recipe', pantry: 'In your pantry', frequent: 'You eat this often' };

/** Short source badges, from the reason codes the server attached. */
export function originBadges(reasons: { code: string }[]): string[] {
  return reasons.map((r) => ORIGIN_BADGE[r.code]).filter((x): x is string => !!x);
}

/** Nutrients to call out as "short on": real goals whose data is complete (never ones the day's data can't support). */
export function shortOn(gaps: GapReport['gaps']): string[] {
  const hidden = new Set([1008, 1005, 1004]); // calories, carbs, fat are shown above
  return gaps.filter((g) => g.kind === 'Goal' && g.dataComplete && !hidden.has(g.nutrientId)).map((g) => g.name.toLowerCase());
}

/** Copy for the empty state, by why there is nothing to show. */
export function emptyCopy(r: Pick<GapReport, 'situation' | 'emptyReason' | 'emptyMessage' | 'mode'>): { title: string; body?: string } {
  const body = r.emptyMessage ?? undefined;
  switch (r.emptyReason) {
    case 'Over': return { title: 'Nothing to add today', body };
    case 'AtTarget': return { title: 'Right on target', body };
    case 'NeedsMet': return { title: 'Today’s goals look covered', body };
    case 'NoPantry': return { title: 'No pantry foods to suggest', body };
    case 'NoRecipes': return { title: 'No saved recipes to suggest', body };
    case 'NoRoomForMeal': return { title: 'No room for a meal', body };
    case 'AlreadyOnToday': return { title: 'Already on today', body };
    case 'Exhausted': return { title: 'No more matching ideas right now.', body: 'You’ve seen every idea that fits. Start over to see them again, or try another filter.' };
    default: return { title: 'Nothing fits well right now', body };
  }
}

/** The most ideas remembered as shown in one session (the server reads at most 300). */
export const MAX_SKIPPED = 300;

/**
 * "Show different ideas": everything shown so far plus what's on screen now, each once, oldest dropped past the cap.
 * Ids are the server's (same foods in any order = same id), so a reordered combination never comes back as new.
 */
export function skipShown(skipped: readonly string[], shown: readonly { id: string }[]): string[] {
  const next = [...skipped];
  for (const s of shown) if (s.id && !next.includes(s.id)) next.push(s.id);
  return next.slice(-MAX_SKIPPED);
}

/** What to offer under the ideas: more to see, the end of the list (with a way to start over), or nothing. */
export function rotationState(r: Pick<GapReport, 'suggestions' | 'moreIdeas' | 'skippedIdeas'>, skipped: readonly string[]): 'more' | 'end' | 'none' {
  if (r.suggestions.length === 0) return 'none';
  if ((r.moreIdeas ?? 0) > 0) return 'more';
  return skipped.length > 0 || (r.skippedIdeas ?? 0) > 0 ? 'end' : 'none';
}
