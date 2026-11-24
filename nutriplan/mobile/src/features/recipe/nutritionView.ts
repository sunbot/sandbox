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

/* ───────── Three separate measures of trust ───────── */

/** Nutrients people check most, with USDA ids. Absent from a food's data = unknown (never zero). */
export const KEY_NUTRIENTS: { id: number; name: string }[] = [
  { id: 1079, name: 'fiber' }, { id: 2000, name: 'sugars' }, { id: 1235, name: 'added sugars' }, { id: 1258, name: 'saturated fat' },
  { id: 1093, name: 'sodium' }, { id: 1114, name: 'vitamin D' }, { id: 1190, name: 'folate' }, { id: 1178, name: 'vitamin B12' },
];

/** A match you confirmed, or a close automatic one, counts as confident. */
export const CONFIDENT_MATCH = 0.8;

export type RecipeTrust = {
  /** Lines with a food and an amount, out of all ingredient lines. */
  coverage: { counted: number; total: number; percent: number };
  /** Share of the counted calories that come from confirmed or close matches (a weak match on salt hardly matters; on coconut milk it does). */
  confidence: { percent: number | null; toCheck: number };
  /** For each key nutrient, the share of the counted ingredients' weight whose food reports it. */
  completeness: { complete: number; total: number; partial: { name: string; percent: number }[] };
};

type TrustInput = Pick<Ingredient, 'status' | 'note' | 'grams' | 'matchConfidence' | 'nutrition'>;

/**
 * Coverage, confidence and completeness, kept apart: "100% matched" can still be the wrong food, and the right food can
 * still have no vitamin D data. Pure; computed from the ingredient lines the API returns.
 */
export function recipeTrust(ings: TrustInput[]): RecipeTrust {
  const counts = ingredientCounts(ings);
  const counted = ings.filter((i) => { const s = ingredientState(i); return s !== 'header' && s !== 'excluded' && s !== 'unmatched' && i.nutrition != null; });
  const kcal = counted.reduce((n, i) => n + Math.max(0, i.nutrition!.calories), 0);
  const sure = counted.filter((i) => i.status === 'Confirmed' || i.matchConfidence >= CONFIDENT_MATCH).reduce((n, i) => n + Math.max(0, i.nutrition!.calories), 0);
  const weight = counted.reduce((n, i) => n + (i.grams ?? 0), 0);
  const partial: { name: string; percent: number }[] = [];
  let complete = 0;
  for (const k of KEY_NUTRIENTS) {
    if (weight <= 0) break;
    const known = counted.filter((i) => i.nutrition!.nutrients?.[String(k.id)] != null).reduce((n, i) => n + (i.grams ?? 0), 0);
    const pct = Math.round((known / weight) * 100);
    if (pct >= 100) complete += 1; else partial.push({ name: k.name, percent: pct });
  }
  return {
    coverage: { counted: counts.counted, total: counts.total, percent: counts.total ? Math.round((counts.counted / counts.total) * 100) : 0 },
    confidence: { percent: kcal > 0 ? Math.round((sure / kcal) * 100) : null, toCheck: counts.check },
    completeness: { complete: weight > 0 ? complete : 0, total: weight > 0 ? KEY_NUTRIENTS.length : 0, partial },
  };
}

const DATASET: Record<string, string> = {
  UsdaFoundation: 'USDA Foundation (lab-analysed)', UsdaSrLegacy: 'USDA SR Legacy', UsdaSurvey: 'USDA FNDDS (food as eaten, often cooked)',
  UsdaBranded: 'USDA branded label', OpenFoodFacts: 'Open Food Facts (crowd-sourced)', User: 'Your food', Recipe: 'Your recipe',
};

/** Where a matched food's numbers come from and how sure the match is, in words: "USDA SR Legacy · close match (92%)". */
export function matchDetail(ing: Pick<Ingredient, 'status' | 'matchConfidence' | 'foodSource'>): string | null {
  if (!ing.foodSource) return null;
  const source = DATASET[ing.foodSource] ?? ing.foodSource;
  const pct = Math.round(ing.matchConfidence * 100);
  const sure = ing.status === 'Confirmed' ? 'confirmed by you'
    : ing.matchConfidence >= CONFIDENT_MATCH ? `close match (${pct}%)`
    : ing.matchConfidence >= 0.5 ? `likely match (${pct}%)` : `weak match (${pct}%)`;
  return `${source} · ${sure}`;
}

/** The three measures as short lines for the recipe screen. */
export function trustLines(tr: RecipeTrust): { label: string; value: string; detail?: string; weak: boolean }[] {
  const lines: { label: string; value: string; detail?: string; weak: boolean }[] = [
    { label: 'Ingredients counted', value: `${tr.coverage.counted} of ${tr.coverage.total}`, weak: tr.coverage.counted < tr.coverage.total },
  ];
  if (tr.confidence.percent != null) {
    lines.push({
      label: 'Food matches',
      value: `${tr.confidence.percent}% of calories from confirmed or close matches`,
      detail: tr.confidence.toCheck ? `${tr.confidence.toCheck} to check` : undefined,
      weak: tr.confidence.percent < 90,
    });
  }
  if (tr.completeness.total > 0) {
    const missing = tr.completeness.partial.map((p) => `${p.name} ${p.percent}%`).join(', ');
    lines.push({
      label: 'Nutrient data',
      value: `${tr.completeness.complete} of ${tr.completeness.total} key nutrients known for every ingredient`,
      detail: missing ? `Known for part of the recipe (by weight): ${missing}. Those totals are minimums.` : undefined,
      weak: tr.completeness.partial.length > 0,
    });
  }
  return lines;
}

/** Share of the recipe's calories from one ingredient, for the row's secondary read-out. null when unknown. */
export const calorieShare = (ingredientKcal: number | null | undefined, totalRecipeKcal: number): number | null =>
  ingredientKcal != null && totalRecipeKcal > 0 ? Math.round((ingredientKcal / totalRecipeKcal) * 100) : null;

/* ───────── Logging ───────── */

export type LogRecipeInput = { date: string; meal: Meal; recipeId: string; servings: number; amount?: number; unit?: string };

/**
 * The request for "Log now": exactly the meal and amount the user chose, never a time-of-day guess. An amount in another of
 * the recipe's measures ("1.5 cup") is sent as chosen, with its servings; the server converts and is authoritative.
 */
export const logRecipeRequest = (input: LogRecipeInput): LogRecipeInput => ({
  date: input.date, meal: input.meal, recipeId: input.recipeId, servings: input.servings,
  ...(input.amount !== undefined && input.unit && input.unit !== 'serving' ? { amount: input.amount, unit: input.unit } : {}),
});

export const servingsWord = (n: number) => `${Number.isInteger(n) ? n : Math.round(n * 100) / 100} serving${n === 1 ? '' : 's'}`;

/* ───────── Scaling ───────── */

/** Scale choices offered on a recipe; the server allows 0–20×. */
export const SCALE_CHOICES = [0.5, 1.5, 2, 3] as const;

/** What scaling will do, in words: "Makes 4 → 8 servings · every amount ×2". */
export function scaleSummary(servings: number, factor: number): string {
  const after = Math.round(servings * factor * 100) / 100;
  return `Makes ${Math.round(servings * 100) / 100} → ${servingsWord(after)} · every amount ×${factor}`;
}

/* ───────── Reviewing ingredients ───────── */

/** The lines that need a look, in recipe order: unmatched, and matches to check (weak or without an amount). */
export function reviewQueue(ings: Pick<Ingredient, 'position' | 'status' | 'note' | 'grams' | 'matchConfidence'>[]): number[] {
  return ings.filter((i) => { const s = ingredientState(i); return s === 'unmatched' || s === 'check'; }).map((i) => i.position);
}

/** The next line to review after `current` (the queue is re-read after every change, so fixed lines drop out); null when done. */
export function nextToReview(queue: number[], current: number | null): number | null {
  if (queue.length === 0) return null;
  if (current === null) return queue[0];
  return queue.find((p) => p > current) ?? null;
}
