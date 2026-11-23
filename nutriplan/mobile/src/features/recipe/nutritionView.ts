/**
 * Pure rules behind the Recipe Details nutrition display. No React, no network: the numbers on screen are derived
 * here from what the server already stored, and never change the authoritative recipe calories.
 *
 * Conventions (same as the backend's EnergyConsistency): protein 4 kcal/g, carbohydrate 4 kcal/g (total carbohydrate,
 * which includes fiber, exactly as the grams are shown), fat 9 kcal/g. The donut splits *macro-derived* energy; it is
 * compared with, but never forced to equal, the reported calories.
 */
import type { Ingredient, Nutrition } from '../../api/types';
import type { Meal } from '../../lib/format';

export const KCAL_PER_GRAM = { protein: 4, carbs: 4, fat: 9 } as const;

export type MacroKey = 'protein' | 'carbs' | 'fat';
export type MacroShare = { key: MacroKey; grams: number; kcal: number; fraction: number; percent: number };
export type MacroComposition = {
  shares: MacroShare[];
  /** Energy implied by the macro grams (4/4/9). */
  macroKcal: number;
  /** Reported calories minus macro-derived energy (fiber, alcohol, rounding…). */
  gapKcal: number;
  /** True when the gap is big enough to say so instead of leaving it unexplained. */
  gapNotable: boolean;
  /** False when there is nothing to draw (all macros zero or unknown). */
  hasData: boolean;
};

const safe = (n: number | null | undefined) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0);

/** Percentages that always add to exactly 100 (largest-remainder rounding), so the legend never reads 99% or 101%. */
export function roundedPercents(fractions: number[]): number[] {
  const total = fractions.reduce((a, b) => a + b, 0);
  if (!(total > 0)) return fractions.map(() => 0);
  const raw = fractions.map((f) => (f / total) * 100);
  const floors = raw.map(Math.floor);
  let left = 100 - floors.reduce((a, b) => a + b, 0);
  const order = raw.map((v, i) => ({ i, rem: v - floors[i] })).sort((a, b) => b.rem - a.rem);
  for (const { i } of order) {
    if (left <= 0) break;
    floors[i] += 1;
    left -= 1;
  }
  return floors;
}

export function macroComposition(n: Pick<Nutrition, 'calories' | 'protein' | 'carbs' | 'fat'>): MacroComposition {
  const grams = { protein: safe(n.protein), carbs: safe(n.carbs), fat: safe(n.fat) };
  const kcal = { protein: grams.protein * 4, carbs: grams.carbs * 4, fat: grams.fat * 9 };
  const macroKcal = kcal.protein + kcal.carbs + kcal.fat;
  const percents = roundedPercents([kcal.protein, kcal.carbs, kcal.fat]);
  const keys: MacroKey[] = ['protein', 'carbs', 'fat'];
  const shares = keys.map((key, i) => ({ key, grams: grams[key], kcal: kcal[key], fraction: macroKcal > 0 ? kcal[key] / macroKcal : 0, percent: percents[i] }));
  const reported = safe(n.calories);
  const gapKcal = reported - macroKcal;
  return {
    shares, macroKcal, gapKcal,
    gapNotable: macroKcal > 0 && reported > 0 && Math.abs(gapKcal) > Math.max(10, reported * 0.08),
    hasData: macroKcal > 0,
  };
}

/* ───────── Display modes ───────── */

export type NutritionMode = 'serving' | 'recipe' | 'per100g';

export type RecipeBasis = {
  /** Server-computed per-serving nutrition (the source of truth). */
  perServing: Nutrition;
  /** How many servings the whole recipe makes. */
  servings: number;
  /** Weight of the finished dish, only when the user/source supplied it. */
  cookedWeightGrams?: number | null;
};

export const per100gAvailable = (basis: Pick<RecipeBasis, 'cookedWeightGrams'>) => typeof basis.cookedWeightGrams === 'number' && basis.cookedWeightGrams > 0;

export function availableModes(basis: RecipeBasis): NutritionMode[] {
  return per100gAvailable(basis) ? ['serving', 'recipe', 'per100g'] : ['serving', 'recipe'];
}

/** Everything but the nutrient map is scaled; nutrients that are unknown stay unknown. */
export function scaleNutrition(n: Nutrition, factor: number): Nutrition {
  const nutrients: Record<string, number> = {};
  for (const [k, v] of Object.entries(n.nutrients ?? {})) nutrients[k] = v * factor;
  return { calories: n.calories * factor, protein: n.protein * factor, carbs: n.carbs * factor, fat: n.fat * factor, fiber: n.fiber * factor, nutrients };
}

/**
 * The numbers for one display mode. Per serving is the stored value; whole recipe is per-serving × servings made;
 * per 100 g divides the whole recipe by the finished weight. Returns null for per-100-g when no weight is known:
 * a weight is never guessed from the ingredients (raw ingredient weight is not the cooked weight).
 */
export function nutritionFor(basis: RecipeBasis, mode: NutritionMode): Nutrition | null {
  const servings = basis.servings > 0 ? basis.servings : 1;
  switch (mode) {
    case 'serving': return basis.perServing;
    case 'recipe': return scaleNutrition(basis.perServing, servings);
    case 'per100g': return per100gAvailable(basis) ? scaleNutrition(basis.perServing, (servings / basis.cookedWeightGrams!) * 100) : null;
  }
}

/** If the chosen mode stops being available (the weight was removed), fall back to per serving. */
export const effectiveMode = (mode: NutritionMode, basis: RecipeBasis): NutritionMode => (availableModes(basis).includes(mode) ? mode : 'serving');

export const gramsPerServing = (basis: RecipeBasis): number | null =>
  per100gAvailable(basis) && basis.servings > 0 ? basis.cookedWeightGrams! / basis.servings : null;

export const modeLabel: Record<NutritionMode, string> = { serving: 'Per serving', recipe: 'Whole recipe', per100g: 'Per 100 g' };

/** What the user is about to eat: n servings (fractions allowed), independent of the display mode and the yield. */
export function eatingNutrition(perServing: Nutrition, servingsEaten: number): Nutrition {
  return scaleNutrition(perServing, servingsEaten > 0 ? servingsEaten : 0);
}

/** Parses a servings box ("1.5", "1,5", "½" is not supported); empty/invalid/zero → null so callers can ask again. */
export function parseServings(text: string): number | null {
  const v = Number(text.trim().replace(',', '.'));
  return Number.isFinite(v) && v > 0 && v <= 1000 ? v : null;
}

/* ───────── Ingredients ───────── */

export type IngredientState = 'header' | 'excluded' | 'unmatched' | 'check' | 'confirmed' | 'matched';

/** Section headers ("For the sauce") are not ingredients. Everything else falls in exactly one state. */
export function ingredientState(ing: Pick<Ingredient, 'status' | 'note' | 'grams' | 'matchConfidence'>): IngredientState {
  if (ing.status === 'Ignored') return ing.note === 'Section header' ? 'header' : 'excluded';
  if (ing.status === 'Unmatched') return 'unmatched';
  if (ing.status === 'Confirmed') return 'confirmed';
  // Auto-matched, but no usable amount or a weak match: ambiguous until the user looks.
  return ing.grams == null || ing.matchConfidence < 0.5 ? 'check' : 'matched';
}

export type IngredientCounts = { total: number; counted: number; unmatched: number; check: number; excluded: number; confirmed: number };

export function ingredientCounts(ings: Pick<Ingredient, 'status' | 'note' | 'grams' | 'matchConfidence' | 'nutrition'>[]): IngredientCounts {
  const c: IngredientCounts = { total: 0, counted: 0, unmatched: 0, check: 0, excluded: 0, confirmed: 0 };
  for (const ing of ings) {
    const s = ingredientState(ing);
    if (s === 'header') continue;
    c.total += 1;
    if (s === 'excluded') c.excluded += 1;
    else if (s === 'unmatched') c.unmatched += 1;
    else {
      if (s === 'check') c.check += 1;
      if (s === 'confirmed') c.confirmed += 1;
      if (ing.nutrition != null) c.counted += 1;
    }
  }
  return c;
}

/**
 * Plain-language limit of the numbers. Coverage = lines that have a food and an amount; it says nothing about
 * whether each match is the right food or the right amount, so even 100% is "calculated", not "verified".
 */
export function reliabilityNote(coverage: number, counts: IngredientCounts): { level: 'complete' | 'partial'; text: string } {
  const missing = counts.unmatched + counts.check + counts.excluded;
  if (coverage >= 0.999 && missing === 0) {
    return { level: 'complete', text: `Calculated from all ${counts.total} ingredients using USDA matches. Check that each match is the food you used.` };
  }
  const pct = Math.round(coverage * 100);
  const parts = [counts.unmatched && `${counts.unmatched} unmatched`, counts.check && `${counts.check} to check`, counts.excluded && `${counts.excluded} left out`].filter(Boolean).join(', ');
  return { level: 'partial', text: `Based on ${pct}% of ingredients${parts ? ` (${parts})` : ''}. Totals are minimums until these are fixed.` };
}

/** Share of the recipe's calories from one ingredient, for the row's secondary read-out. null when unknown. */
export const calorieShare = (ingredientKcal: number | null | undefined, totalRecipeKcal: number): number | null =>
  ingredientKcal != null && totalRecipeKcal > 0 ? Math.round((ingredientKcal / totalRecipeKcal) * 100) : null;

/* ───────── Ingredient amount editor ───────── */

export type GramsEditor = { openFor: number | null; text: string; dirty: boolean };
export const closedEditor: GramsEditor = { openFor: null, text: '', dirty: false };

const gramsText = (grams: number | null | undefined) => (grams ? String(Math.round(grams * 10) / 10) : '');

/**
 * Keeps the grams box in step with the ingredient being shown. Opening (or reopening, even the same ingredient) starts
 * from the current saved grams; while the sheet stays open, the user's typing is kept, and a server update only replaces
 * the box when the user hasn't typed anything.
 */
export function syncGramsEditor(state: GramsEditor, ingredient: Pick<Ingredient, 'position' | 'grams'> | null): GramsEditor {
  if (!ingredient) return state.openFor === null && !state.dirty && state.text === '' ? state : closedEditor;
  if (state.openFor !== ingredient.position) return { openFor: ingredient.position, text: gramsText(ingredient.grams), dirty: false };
  if (!state.dirty && state.text !== gramsText(ingredient.grams)) return { ...state, text: gramsText(ingredient.grams) };
  return state;
}

export const typeGrams = (state: GramsEditor, text: string): GramsEditor => ({ ...state, text, dirty: true });

/* ───────── Logging ───────── */

export type LogRecipeInput = { date: string; meal: Meal; recipeId: string; servings: number };

/** The request for "Log now": exactly the meal and servings the user chose, never a time-of-day guess. */
export const logRecipeRequest = (input: LogRecipeInput): LogRecipeInput => ({ date: input.date, meal: input.meal, recipeId: input.recipeId, servings: input.servings });

export const servingsWord = (n: number) => `${Number.isInteger(n) ? n : Math.round(n * 100) / 100} serving${n === 1 ? '' : 's'}`;

/* ───────── Scaling ───────── */

/** Scale choices offered on a recipe; the server allows 0–20×. */
export const SCALE_CHOICES = [0.5, 1.5, 2, 3] as const;

/** What scaling will do, in words: "Makes 4 → 8 servings · every amount ×2". */
export function scaleSummary(servings: number, factor: number): string {
  const after = Math.round(servings * factor * 100) / 100;
  return `Makes ${Math.round(servings * 100) / 100} → ${servingsWord(after)} · every amount ×${factor}`;
}
