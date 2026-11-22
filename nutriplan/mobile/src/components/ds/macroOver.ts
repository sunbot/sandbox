/**
 * How far a macro is over its target, for the summary bars (pure, so it's tested without a renderer). Bars stop at full, so
 * past the target the amount over has to be said in words, or the bar looks stuck (reported: "fat doesn't go up past a point").
 * Null within 5 % of the target (rounding and a bite more aren't "over").
 */
export function macroOver(value: number, target: number): number | null {
  if (!(target > 0) || !(value > target * 1.05)) return null;
  return value - target;
}

/** The share of the bar to fill: 0–1, however far over. The number shown is never capped. */
export const barFill = (value: number, target: number) => (target > 0 ? Math.max(0, Math.min(1, value / target)) : 0);
