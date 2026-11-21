/**
 * The review draft behind Ask's "Log all": one entry per food the assistant found, each with the chosen USDA match
 * and amount. Pure functions only (no React, no network) so the rules are easy to test.
 *
 * Nutrition shown here is a preview: the per-100 g values USDA provides × the chosen grams. The server works out the
 * saved numbers itself from the food id and grams when you log, so the preview never becomes the source of truth.
 */
import type { Food, FoodAmount, FoodMatch, FoodMatchGroup, Portion, QuantityStatus } from '@/api/types';

export type DraftStatus = QuantityStatus | 'Edited';

export type DraftItem = {
  key: string;
  group: FoodMatchGroup;
  /** Index into group.matches; -1 when nothing matched. */
  matchIndex: number;
  /** Chosen weight in grams; null means an amount still has to be chosen. */
  grams: number | null;
  /** How the amount reads, e.g. "2 large", "150 g". */
  amountLabel: string | null;
  status: DraftStatus;
  removed: boolean;
};

export type Preview = { calories: number; protein: number; carbs: number; fat: number };

/** Matches below this confidence are highlighted for a second look. */
export const LOW_CONFIDENCE = 0.5;

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const fmtNumber = (n: number) => (Number.isInteger(n) ? String(n) : String(round(n, 2)));

export function selectedMatch(item: DraftItem): FoodMatch | undefined {
  return item.matchIndex >= 0 ? item.group.matches[item.matchIndex] : undefined;
}

/** "1 × medium (118 g each)" → "1 medium"; "2 cup ≈ 316 g (…)" → "2 cup"; otherwise "118 g". */
function labelFor(group: FoodMatchGroup, match: FoodMatch): string | null {
  const grams = match.quantity.grams;
  if (grams == null) return null;
  // "2 × large (50 g each)": the USDA portion name says more than a bare "2".
  const portion = /^([\d.]+) × (.+?) \(/.exec(match.quantity.explanation);
  if (match.quantity.status === 'Given' && group.amount != null && group.unit) return `${fmtNumber(group.amount)} ${group.unit}`;
  if (portion) return `${portion[1]} ${portion[2]}`;
  if (match.quantity.status === 'Given' && group.amount != null) return fmtNumber(group.amount);
  return `${Math.round(grams)} g`;
}

function fromMatch(group: FoodMatchGroup, matchIndex: number): Pick<DraftItem, 'grams' | 'amountLabel' | 'status'> {
  const m = group.matches[matchIndex];
  if (!m) return { grams: null, amountLabel: null, status: 'NeedsAmount' };
  return { grams: m.quantity.grams ?? null, amountLabel: labelFor(group, m), status: m.quantity.status ?? (m.quantity.grams == null ? 'NeedsAmount' : 'Given') };
}

/** One draft item per food the assistant found, each starting on its best match. */
export function draftFrom(groups: FoodMatchGroup[]): DraftItem[] {
  return groups.map((group, i) => ({
    key: `${i}:${group.text}`,
    group,
    matchIndex: group.matches.length ? 0 : -1,
    removed: false,
    ...fromMatch(group, group.matches.length ? 0 : -1),
  }));
}

/**
 * Switch to another match. Each match already carries the server's conversion of what you said for *that* food,
 * so its own grams are used — unless you had set the amount yourself, which is kept.
 */
export function selectMatch(item: DraftItem, matchIndex: number): DraftItem {
  if (matchIndex === item.matchIndex || !item.group.matches[matchIndex]) return item;
  if (item.status === 'Edited' && item.grams != null) return { ...item, matchIndex };
  return { ...item, matchIndex, ...fromMatch(item.group, matchIndex) };
}

/** Set the amount explicitly: a count of a USDA portion (or grams/ounces). */
export function setAmount(item: DraftItem, count: number, option: AmountOption): DraftItem {
  if (!(count > 0)) return item;
  const grams = round(count * option.grams);
  const label = option.label === 'g' ? `${fmtNumber(round(count, 1))} g` : `${fmtNumber(round(count, 2))} ${option.label}`;
  return { ...item, grams, amountLabel: label, status: 'Edited' };
}

export const setRemoved = (item: DraftItem, removed: boolean): DraftItem => ({ ...item, removed });

export function replaceItem(items: DraftItem[], next: DraftItem): DraftItem[] {
  return items.map((i) => (i.key === next.key ? next : i));
}

export type AmountOption = { label: string; grams: number };

/** Ways to say an amount for this food: its USDA portions first, then grams and ounces. */
export function amountOptions(portions: Portion[]): AmountOption[] {
  const seen = new Set<string>();
  const out: AmountOption[] = [];
  for (const p of portions) {
    const key = p.description.trim().toLowerCase();
    if (!key || seen.has(key) || !(p.grams > 0)) continue;
    seen.add(key);
    out.push({ label: p.description.trim(), grams: p.grams });
  }
  out.push({ label: 'g', grams: 1 }, { label: 'oz', grams: 28.3495 });
  return out;
}

export function preview(item: DraftItem): Preview | null {
  const m = selectedMatch(item);
  if (!m || item.grams == null) return null;
  const f = item.grams / 100;
  const n = m.food.per100g;
  return { calories: n.calories * f, protein: n.protein * f, carbs: n.carbs * f, fat: n.fat * f };
}

/** Index of this food's other raw/cooked version among its matches, or -1 when it isn't offered. */
export function otherPreparationIndex(item: DraftItem): number {
  const other = selectedMatch(item)?.preparation?.otherFoodId;
  return other ? item.group.matches.findIndex((m) => m.food.id === other) : -1;
}

export const active = (items: DraftItem[]) => items.filter((i) => !i.removed);

export function totals(items: DraftItem[]): Preview {
  return active(items).reduce<Preview>((sum, i) => {
    const p = preview(i);
    return p ? { calories: sum.calories + p.calories, protein: sum.protein + p.protein, carbs: sum.carbs + p.carbs, fat: sum.fat + p.fat } : sum;
  }, { calories: 0, protein: 0, carbs: 0, fat: 0 });
}

/** True when this item deserves a second look: an uncertain match or an assumed amount. */
export function needsLook(item: DraftItem): boolean {
  const m = selectedMatch(item);
  return !!m && (m.confidence < LOW_CONFIDENCE || item.status === 'Assumed');
}

/** Items that must be fixed (or removed) before anything can be logged: no match, or no amount. */
export function blockers(items: DraftItem[]): DraftItem[] {
  return active(items).filter((i) => !selectedMatch(i) || i.grams == null);
}

/** The request body for /diary/foods or /plan/foods. Grams only: the server computes the nutrition snapshot. */
export function toRequest(items: DraftItem[]): FoodAmount[] {
  if (blockers(items).length) throw new Error('Some foods still need a match or an amount.');
  return active(items).map((i) => ({ foodId: selectedMatch(i)!.food.id, grams: i.grams! }));
}

/**
 * A food found by searching joins this item's choices. There is no conversion of what you said for it yet, so the
 * amount must be chosen (unless you had already set it in grams yourself).
 */
export function withPickedFood(item: DraftItem, food: Food): DraftItem {
  const existing = item.group.matches.findIndex((m) => m.food.id === food.id);
  if (existing >= 0) return selectMatch(item, existing);
  const matches = [...item.group.matches, {
    food, score: 0, confidence: 1, nutrition: null,
    quantity: { grams: null, method: 'Unresolved', explanation: 'Chosen by you. Choose how much.', status: 'NeedsAmount' as const },
  }];
  const keepGrams = item.status === 'Edited' && /\bg$/.test(item.amountLabel ?? '');
  return { ...item, group: { ...item.group, matches }, matchIndex: matches.length - 1,
    grams: keepGrams ? item.grams : null, amountLabel: keepGrams ? item.amountLabel : null, status: keepGrams ? 'Edited' : 'NeedsAmount' };
}
