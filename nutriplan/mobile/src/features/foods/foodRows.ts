/**
 * How a food reads in search results: name, brand, the serving it's shown for, calories and macros for that serving,
 * and where the numbers come from. Pure (no React), so the rules are tested.
 *
 * Packaged products are shown per labelled serving when the label gives its size; generic foods per 100 g. A drink
 * labelled by volume is per 100 ml, never converted to grams.
 */
import type { BrandedFood, Food, Nutrition, RecipeSummary } from '../../api/types';

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

const words = (s: string) => s.toLowerCase().replace(/['’]/g, '').split(/[^a-z0-9]+/).filter((w) => w.length > 1);

/**
 * Show packaged products above your foods when the search names a brand (it matches a brand among the top branded
 * results) that none of the top local results mention: "Core Power" shouldn't sit under three Powerade drinks. Generic
 * searches ("chicken breast") and brands already in your foods keep your foods first.
 */
export function packagedFirst(query: string, local: Pick<Food, 'name' | 'brand'>[], branded: Pick<BrandedFood, 'brand'>[]): boolean {
  const q = new Set(words(query));
  const brandWords = new Set(branded.slice(0, 3).flatMap((b) => words(b.brand ?? '')));
  const named = [...q].filter((w) => brandWords.has(w));
  if (named.length === 0) return false;
  const localWords = new Set(local.slice(0, 3).flatMap((f) => words(`${f.name} ${f.brand ?? ''}`)));
  // "Dave's Killer Bread" isn't covered by plain breads: every word of the brand you typed must appear locally.
  return named.some((w) => !localWords.has(w));
}

/**
 * One of your recipes in search: per serving (what you'd log), how many it makes, and "Your recipe" as its source so it
 * never reads as a food. A recipe with ingredients that aren't counted is flagged: its numbers are a minimum.
 */
export function recipeRow(r: RecipeSummary): FoodRow {
  return {
    title: r.name,
    brand: null,
    basis: `per serving · makes ${fmt(r.servings)}`,
    calories: r0(r.perServing.calories),
    macros: macroText(r.perServing),
    source: 'Your recipe',
    note: [matchNote(r), r.coverage < 1 ? `${Math.round(r.coverage * 100)}% of ingredients counted` : null].filter(Boolean).join(' · ') || null,
  };
}

/** Why a recipe is in the results when its name doesn't match the search (#84): "Matches ingredient: 1 tbsp apple cider vinegar". */
export function matchNote(r: Pick<RecipeSummary, 'matchedOn' | 'matchedText'>): string | null {
  if (r.matchedOn === 'Ingredient') return `Matches ingredient: ${r.matchedText ?? ''}`.trim();
  if (r.matchedOn === 'Category') return `Matches category: ${r.matchedText ?? ''}`.trim();
  if (r.matchedOn === 'Description') return 'Matches description';
  return null;
}

/** Your recipes matching a search, best first: names that start with the words, then the rest; never the recipe being edited. */
export function recipeMatches(recipes: RecipeSummary[], text: string, exceptId?: string): RecipeSummary[] {
  const q = text.trim().toLowerCase();
  if (q.length < 2) return [];
  return recipes
    .filter((r) => r.id !== exceptId)
    .map((r, i) => ({ r, i, starts: r.name.toLowerCase().startsWith(q), byName: !r.matchedOn }))
    .sort((a, b) => Number(b.byName) - Number(a.byName) || Number(b.starts) - Number(a.starts) || a.i - b.i)
    .map((x) => x.r);
}
