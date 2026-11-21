/**
 * How a food reads in search results: name, brand, the serving it's shown for, calories and macros for that serving,
 * and where the numbers come from. Pure (no React), so the rules are tested.
 *
 * Packaged products are shown per labelled serving when the label gives its size; generic foods per 100 g. A drink
 * labelled by volume is per 100 ml, never converted to grams.
 */
import type { BrandedFood, Food, Nutrition } from '../../api/types';

export type FoodRow = {
  title: string;
  brand: string | null;
  /** "1 slice (40 g)", "per 100 g", "1 shake (330 ml)". */
  basis: string;
  calories: number | null;
  macros: string | null;
  source: string;
  /** Shown as a caution: missing or calculated calories. */
  note: string | null;
};

const r0 = (n: number) => Math.round(n);
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10));
const macroText = (n: Nutrition) => `P ${r0(n.protein)} g · C ${r0(n.carbs)} g · F ${r0(n.fat)} g`;

export const sourceLabel = (source: string): string => ({
  UsdaFoundation: 'USDA', UsdaSrLegacy: 'USDA', UsdaSurvey: 'USDA', UsdaBranded: 'USDA branded', OpenFoodFacts: 'Open Food Facts', User: 'Yours', Recipe: 'Recipe',
} as Record<string, string>)[source] ?? source;

const scale = (n: Nutrition, f: number): Nutrition => ({ ...n, calories: n.calories * f, protein: n.protein * f, carbs: n.carbs * f, fat: n.fat * f, fiber: n.fiber * f });

const hasCalories = (n: Nutrition) => Object.prototype.hasOwnProperty.call(n.nutrients ?? {}, '1008') || n.calories > 0;

/** A food already in your database. Branded and scanned foods show their first (labelled) portion; generic foods per 100 g. */
export function localRow(f: Food): FoodRow {
  const unit = f.baseUnit ?? 'g';
  const packaged = f.source === 'UsdaBranded' || f.source === 'OpenFoodFacts' || f.source === 'User';
  const portion = packaged ? f.portions[0] : undefined;
  const n = portion ? scale(f.per100g, portion.grams / 100) : f.per100g;
  const known = hasCalories(f.per100g);
  return {
    title: f.name,
    brand: f.brand ?? null,
    basis: portion ? `${portion.description} (${fmt(portion.grams)} ${unit})` : `per 100 ${unit}`,
    calories: known ? r0(n.calories) : null,
    macros: macroText(n),
    source: sourceLabel(f.source),
    note: known ? (f.qualityNote?.startsWith('Calories calculated') ? 'Calories calculated from macros' : null) : 'Calories not on the label',
  };
}

/** A USDA branded search result (not saved yet). */
export function brandedRow(b: BrandedFood): FoodRow {
  const n = b.perServing ?? b.per100;
  return {
    title: b.name,
    brand: b.brand ?? null,
    basis: b.perServing && b.servingDescription ? b.servingDescription : `per 100 ${b.baseUnit}`,
    calories: b.caloriesMissing ? null : r0(n.calories),
    macros: macroText(n),
    source: 'USDA branded',
    note: b.caloriesMissing ? 'Calories not on the label' : b.caloriesCalculated ? 'Calories calculated from macros' : null,
  };
}

/** Spoken summary with the same facts as the row. */
export const rowLabel = (r: FoodRow) =>
  `${r.brand ? `${r.brand}, ` : ''}${r.title}. ${r.basis}: ${r.calories == null ? 'calories unknown' : `${r.calories} calories`}${r.macros ? `, ${r.macros.replace(/P /, 'protein ').replace(/C /, 'carbs ').replace(/F /, 'fat ')}` : ''}. ${r.source}${r.note ? `. ${r.note}` : ''}.`;

/** Branded results that are already in your foods (by provider id) aren't shown twice. */
export function withoutSaved(branded: BrandedFood[], local: Food[]): BrandedFood[] {
  const saved = new Set(local.map((f) => f.id));
  return branded.filter((b) => !b.localFoodId || !saved.has(b.localFoodId));
}

/** Why the branded section is empty or partial, in plain words; null when there's nothing to say. */
export function brandedNotice(failure?: string | null): string | null {
  switch (failure) {
    case undefined: case null: case '': return null;
    case 'NotConfigured': return 'Branded search isn’t set up on the server yet (it needs a USDA API key).';
    case 'RateLimited': return 'USDA is busy right now. Your own foods still work; try branded search again in a minute.';
    case 'Timeout': return 'USDA took too long to answer. Your own foods still work; try again.';
    default: return 'Couldn’t reach USDA for branded products. Your own foods still work.';
  }
}
