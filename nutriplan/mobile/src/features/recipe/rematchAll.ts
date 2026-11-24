import type { RecipeRematch, RematchLine } from '../../api/types';

/** "Coconut milk → Coconut milk, canned (383 g)", "unmatched → Lentils, raw", "Oats → not matched". */
export function lineChange(l: RematchLine): string {
  const g = (n?: number | null) => (n != null ? ` (${Math.round(n)} g)` : '');
  const before = l.foodBefore ? `${l.foodBefore}${g(l.gramsBefore)}` : 'not matched';
  const after = l.foodAfter ? `${l.foodAfter}${g(l.gramsAfter)}` : 'not matched';
  return `${before} → ${after}`;
}

/** "364 → 504 kcal per serving" (or "unchanged" when only an unseen detail moved). */
export function kcalChange(r: Pick<RecipeRematch, 'kcalPerServingBefore' | 'kcalPerServingAfter'>): string {
  const a = Math.round(r.kcalPerServingBefore), b = Math.round(r.kcalPerServingAfter);
  return a === b ? `${a} kcal per serving (unchanged)` : `${a} → ${b} kcal per serving`;
}
