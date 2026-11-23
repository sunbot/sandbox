import type { BudgetPreview } from '../../api/types';

const kcal = (n: number) => Math.round(n).toLocaleString('en-US');

/** What the chosen flexibility allows, in kcal. These are limits, not the target for any particular day. */
export function rangeText(p: BudgetPreview, percent: number): string {
  return `With a ${kcal(p.baseTarget)} kcal base target, ±${percent}% permits ${kcal(p.minTarget)}–${kcal(p.maxTarget)} kcal/day.`;
}

/** An example of the weekly balancing; the numbers come from the server's production calculation. Null when there's nothing to show. */
export function exampleText(p: BudgetPreview): string | null {
  if (p.nextDaysTarget == null || p.daysAfterToday <= 0) return null;
  const days = p.daysAfterToday === 1 ? 'tomorrow' : `the ${p.daysAfterToday} days after today`;
  const over = p.extraKcal >= 0 ? `${kcal(p.extraKcal)} kcal above` : `${kcal(-p.extraKcal)} kcal below`;
  const base = `If today ends ${over} its ${kcal(p.todayTarget)} kcal target, ${days} would be about ${kcal(p.nextDaysTarget)} kcal each.`;
  return p.capReached ? `${base} That hits the daily limit, so ${kcal(Math.abs(p.unabsorbedCarryover))} kcal isn't made up this week.` : base;
}
