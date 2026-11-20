/** Dates travel as ISO "YYYY-MM-DD" strings (local calendar day, no time zone). */
export function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function fromIsoDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function today(): string {
  return toIsoDate(new Date());
}

export function addDays(iso: string, days: number): string {
  const d = fromIsoDate(iso);
  d.setDate(d.getDate() + days);
  return toIsoDate(d);
}

export function dayLabel(iso: string): string {
  const t = today();
  if (iso === t) return 'Today';
  if (iso === addDays(t, -1)) return 'Yesterday';
  if (iso === addDays(t, 1)) return 'Tomorrow';
  return fromIsoDate(iso).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

export function shortDay(iso: string): string {
  return fromIsoDate(iso).toLocaleDateString(undefined, { weekday: 'short' });
}

export const kcal = (n: number) => `${Math.round(n)}`;
export const grams = (n: number) => (n >= 10 ? `${Math.round(n)} g` : `${n.toFixed(1)} g`);

export function amount(value: number, unit: string): string {
  const v = Number.isInteger(value) ? String(value) : value.toFixed(value < 10 ? 2 : 1).replace(/\.?0+$/, '');
  return `${v} ${unit}`;
}

/** The meal that fits the time of day — used as the default when adding food. */
export function mealForNow(): Meal {
  const h = new Date().getHours();
  if (h < 10) return 'Breakfast';
  if (h < 14) return 'Lunch';
  if (h < 17) return 'Snack';
  if (h < 21) return 'Dinner';
  return 'Snack';
}

export type Meal = 'Breakfast' | 'Lunch' | 'Dinner' | 'Snack';
export const meals: Meal[] = ['Breakfast', 'Lunch', 'Dinner', 'Snack'];
