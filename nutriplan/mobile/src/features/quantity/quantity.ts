import type { Item, Measure } from '@/api/types';

/**
 * The one quantity model for logging and editing: parse what was typed, pick and convert between the measures the server
 * says a food really supports, and preview nutrition. All conversion factors come from the server's measure list (USDA
 * portions, labels, exact units); nothing here invents a weight. The server re-resolves and is authoritative on save.
 */

/** Recipes are measured in servings. */
export const SERVING: Measure = { unit: 'serving', label: 'serving', plural: 'servings', base: 1, kind: 'Count', source: null, countable: true };

/** Upper bounds that catch a misplaced zero (mirrors the server's ItemAmounts limits). */
export const MAX_GRAMS = 5000;
export const MAX_SERVINGS = 50;
export const MIN_QUANTITY = 0.001;
export const MIN_BASE = 0.01;

const VULGAR: Record<string, number> = { '½': 0.5, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 0.25, '¾': 0.75, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875 };

/**
 * "12", "0.5", "0,5", "1/2", "1 1/2", "½", "1½" → a number. Returns null for anything that isn't a plain amount
 * (empty, letters, negative, several numbers), so it can never be guessed wrong.
 */
export function parseQuantity(text: string): number | null {
  let s = text.trim().replace(/\s+/g, ' ');
  if (!s) return null;
  for (const [ch, v] of Object.entries(VULGAR)) {
    if (!s.includes(ch)) continue;
    const before = s.slice(0, s.indexOf(ch)).trim();
    if (s.slice(s.indexOf(ch) + 1).trim()) return null;
    const whole = before ? parseQuantity(before) : 0;
    return whole === null || !Number.isInteger(whole) ? null : whole + v;
  }
  const mixed = /^(\d+) (\d+)\/(\d+)$/.exec(s);
  if (mixed) return Number(mixed[3]) === 0 ? null : Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const frac = /^(\d+)\/(\d+)$/.exec(s);
  if (frac) return Number(frac[2]) === 0 ? null : Number(frac[1]) / Number(frac[2]);
  // "1,000" could mean one thousand or 1.000: refuse rather than guess (a decimal comma with 1-2 or 4+ digits is fine).
  if (/^\d+,\d{3}$/.test(s)) return null;
  s = s.replace(',', '.');
  if (!/^\d*\.?\d+$|^\d+\.$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** A quantity for display/editing: up to 2 decimals, no trailing zeros. */
export function formatQuantity(n: number): string {
  if (!Number.isFinite(n)) return '';
  const r = Math.round(n * 100) / 100;
  return String(r);
}

/** "1 container", "12 almonds", "28 g". */
export const measureText = (m: Measure, qty: number) => `${formatQuantity(qty)} ${Math.abs(qty - 1) < 1e-9 ? m.label : m.plural}`;

const ALIASES: Record<string, string> = {
  gram: 'g', grams: 'g', gr: 'g', ounce: 'oz', ounces: 'oz', milliliter: 'ml', milliliters: 'ml', millilitre: 'ml', mls: 'ml',
  cups: 'cup', tablespoon: 'tbsp', tablespoons: 'tbsp', tbs: 'tbsp', teaspoon: 'tsp', teaspoons: 'tsp', 'fluid ounce': 'fl oz', 'fluid ounces': 'fl oz',
  servings: 'serving',
};

/** The measure a stored unit ("g", "almonds", "medium (7\" long)") corresponds to, if the food has it. */
export function matchMeasure(measures: Measure[], unit: string | null | undefined): Measure | undefined {
  if (!unit) return undefined;
  if (unit.trim() === 'T') return measures.find((m) => m.unit === 'tbsp'); // recipe shorthand: capital T is a tablespoon
  const u = unit.trim().toLowerCase();
  const key = ALIASES[u] ?? u;
  return measures.find((m) => m.unit.toLowerCase() === key || m.plural.toLowerCase() === u || m.label.toLowerCase() === u);
}

/** Rounding that suits the unit: grams/ml to 1 decimal, everything else to 2. */
function roundFor(m: Measure, v: number) {
  const step = m.kind === 'Mass' && m.unit === 'g' ? 10 : m.unit === 'ml' ? 10 : 100;
  return Math.round(v * step) / step;
}

/** The same physical amount in another measure (12 almonds → 14.4 g). */
export function convert(qty: number, from: Measure, to: Measure): number {
  if (from.unit === to.unit) return qty;
  return roundFor(to, (qty * from.base) / to.base);
}

export type QuantityCheck = { ok: true; base: number } | { ok: false; message: string };

/** Whether an amount can be saved, and its base amount (grams, ml or servings). */
export function checkQuantity(qty: number | null, m: Measure | undefined, isRecipe = false, baseUnit: 'g' | 'ml' = 'g'): QuantityCheck {
  if (!m) return { ok: false, message: 'Choose a measure.' };
  if (qty === null) return { ok: false, message: 'Enter an amount, like 12, 0.5 or 1/2.' };
  if (!(qty > 0)) return { ok: false, message: 'Enter an amount greater than zero.' };
  const base = qty * m.base;
  // Mirrors the server: amounts that would round to nothing, and a misplaced zero, are refused.
  if (qty < MIN_QUANTITY || (m.base > 0 && base < MIN_BASE)) return { ok: false, message: 'That amount is too small to log.' };
  if (isRecipe && qty > MAX_SERVINGS) return { ok: false, message: `That's more than ${MAX_SERVINGS} servings. Check the amount.` };
  if (!isRecipe && base > MAX_GRAMS) return { ok: false, message: baseUnit === 'ml' ? 'That’s more than 5 litres. Check the amount.' : 'That’s more than 5 kg. Check the amount.' };
  return { ok: true, base };
}

/** The amount to send: rounded to 3 decimals, as the server stores it (so "1/3" is saved and shown as 0.333). */
export const roundAmount = (n: number) => Math.round(n * 1000) / 1000;

/**
 * The measures to offer when editing an item: recipes in servings; foods in the server's list. If the item's own unit
 * isn't in the list (an old entry), it's offered as-is so the amount can still change in that unit (no conversion).
 */
export function measuresForItem(item: Item, foodMeasures: Measure[] | undefined): Measure[] {
  if (item.kind === 'Recipe') return [SERVING];
  const list = foodMeasures ?? [];
  if (matchMeasure(list, item.unit)) return list;
  const own: Measure = { unit: item.unit, label: item.unit, plural: item.unit, base: ownBase(item), kind: 'Count', source: null, countable: false };
  return [own, ...list.filter((m) => own.base > 0 || m.unit !== own.unit)];
}

/** Base amount (grams/ml) of one of the item's own unit, from its recorded weight; 0 when it isn't known (then it can't convert). */
function ownBase(item: Item) {
  return item.grams && item.quantity > 0 ? item.grams / item.quantity : 0;
}

/**
 * The factor to scale an item's logged nutrition by for a new amount, exactly as the server does: same unit → ratio of
 * amounts; otherwise ratio of weights. Returns null when it can't be worked out (the unit can't be converted).
 */
/** Same unit however it's written ("almond"/"almonds", "oz"/"ounces"), as the server judges it. */
export function sameUnit(a: string, b: string, measures: Measure[]): boolean {
  const norm = (s: string) => { const t = s.trim().toLowerCase(); return t.length > 3 && t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t; };
  if (norm(a) === norm(b)) return true;
  const ma = matchMeasure(measures, a);
  return ma !== undefined && ma === matchMeasure(measures, b);
}

export function scaleFactor(item: Item, qty: number, to: Measure, measures: Measure[]): number | null {
  if (!(item.quantity > 0)) return null;
  const same = sameUnit(to.unit, item.unit, measures);
  if (same) return qty / item.quantity;
  const from = matchMeasure(measures, item.unit);
  const oldBase = item.grams && item.grams > 0 ? item.grams : from && from.base > 0 ? item.quantity * from.base : 0;
  if (!(oldBase > 0) || !(to.base > 0)) return null;
  return (qty * to.base) / oldBase;
}

/** The unit (and amount) to show first for an item: its own measure if the food has it. */
export function initialSelection(item: Item, measures: Measure[]): { text: string; unit: string } {
  const own = item.kind === 'Recipe' ? SERVING : matchMeasure(measures, item.unit);
  return { text: formatQuantity(item.quantity), unit: own?.unit ?? item.unit };
}

/** Why a food can't be measured in cups or spoons (only shown for a solid food that has none). */
export function volumeNote(measures: Measure[], baseUnit: 'g' | 'ml' | undefined): string | null {
  if (baseUnit === 'ml' || measures.some((m) => m.kind === 'Volume')) return null;
  return 'No cup or spoon measures: USDA lists no volume weight for this food.';
}

/** Where a new log starts: the grams it was opened with, else the food's natural item ("1 medium", "1 container"), else 100 g/ml. */
export function startingSelection(measures: Measure[], baseUnit: 'g' | 'ml', grams?: number): { text: string; unit: string } {
  if (grams && grams > 0) return { text: formatQuantity(grams), unit: baseUnit };
  const item = measures.find((m) => m.kind === 'Count');
  return item ? { text: '1', unit: item.unit } : { text: '100', unit: baseUnit };
}

/** Per-100 g (or ml) nutrition scaled to a base amount: a preview; the server calculates what's saved. */
export function previewPer100<T extends { calories: number; protein: number; carbs: number; fat: number; fiber: number }>(per100: T, base: number) {
  const f = base / 100;
  return { calories: per100.calories * f, protein: per100.protein * f, carbs: per100.carbs * f, fat: per100.fat * f, fiber: per100.fiber * f };
}

const NO_PLURAL = new Set(['g', 'kg', 'mg', 'oz', 'lb', 'ml', 'l', 'tbsp', 'tsp', 'fl oz', 'small', 'medium', 'large', 'extra-large', 'jumbo', 'regular', 'mini', 'entry']);

/** A unit word for an amount: "12 almonds", "1 almond", "2 cups", "28 g", "2 large" (same plural rules as the server). */
export function unitFor(qty: number, unit: string): string {
  const u = unit.trim();
  if (Math.abs(qty - 1) < 1e-9) return u;
  // A measure named by a number-led phrase ("100-calorie package") takes the plural on its last word.
  const phrase = /^(\d[\d./-]*[- ][a-z][a-z-]*(?: [a-z][a-z-]*)*) ([a-z][a-z-]*)$/i.exec(u);
  if (phrase) return `${phrase[1]} ${unitFor(qty, phrase[2])}`;
  if (NO_PLURAL.has(u.toLowerCase()) || /[\s(),\d]/.test(u) || u.endsWith('s')) return u;
  if (/[^aeiou]y$/i.test(u)) return u.slice(0, -1) + 'ies';
  if (/(ch|sh|x)$/i.test(u)) return u + 'es';
  return u + 's';
}

const ABBREVIATIONS = new Set(['g', 'kg', 'mg', 'oz', 'lb', 'ml', 'l', 'tbsp', 'tsp', 'fl oz']);

/** "almond" → "Almond" for a list of measures (abbreviations such as g, oz and tbsp stay as they are); amount lines keep the unit as written ("12 almonds"). */
export const capitalize = (s: string) => (!s || ABBREVIATIONS.has(s.toLowerCase()) ? s : s[0].toUpperCase() + s.slice(1));

/** Where a measure's weight comes from: the food's own USDA portion, or the linked USDA record it was borrowed from. */
export function sourceText(m: Measure): string | null {
  if (!m.source) return null;
  return m.origin ? `From ${m.origin}: ${m.source}` : `From USDA: ${m.source}`;
}

export const amountText = (qty: number, unit: string) => `${formatQuantity(qty)} ${unitFor(qty, unit)}`;

/** The exact amount behind a converted number, so browsing measures (almonds → oz → almonds) never drifts. */
export type ExactAmount = { text: string; base: number } | null;

/**
 * The same physical amount in another measure. While the shown number is one this function produced, it converts from
 * the exact base amount it remembered, not from the rounded number on screen.
 */
export function switchMeasure(text: string, from: Measure, to: Measure, exact: ExactAmount): { text: string; exact: ExactAmount } {
  const qty = parseQuantity(text);
  if (qty === null || !(qty > 0) || !(from.base > 0) || !(to.base > 0)) return { text, exact: null };
  const base = exact && exact.text === text ? exact.base : qty * from.base;
  const next = formatQuantity(roundFor(to, base / to.base));
  return { text: next, exact: { text: next, base } };
}
