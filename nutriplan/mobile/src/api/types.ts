// Shapes returned by the NutriPlan API (mirrors the C# DTOs in NutriPlan.Application).
import type { Meal } from '@/lib/format';

export type Nutrition = {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  nutrients: Record<string, number>;
};

export type Portion = { description: string; grams: number };

export type Food = {
  id: string;
  name: string;
  brand?: string | null;
  source: string;
  quality: 'Verified' | 'Standard' | 'Unverified' | 'Flagged';
  qualityNote?: string | null;
  barcode?: string | null;
  per100g: Nutrition;
  portions: Portion[];
};

export type Item = {
  kind: 'Food' | 'Recipe' | 'QuickCalories';
  foodId?: string | null;
  recipeId?: string | null;
  name: string;
  quantity: number;
  unit: string;
  grams?: number | null;
  nutrition: Nutrition;
};

export type DiaryEntry = { id: string; date: string; meal: Meal; item: Item; planEntryId?: string | null; note?: string | null };

export type NutrientProgress = { nutrientId: number; name: string; unit: string; amount: number; target?: number | null; percent?: number | null; kind: 'Goal' | 'Limit' };

export type Day = {
  date: string;
  totals: Nutrition;
  meals: { meal: Meal; totals: Nutrition; entries: DiaryEntry[] }[];
  progress: NutrientProgress[];
};

export type QuickLogItem = { item: Item; usualMeal: Meal; timesLogged: number; lastLogged: string };

export type PlanEntry = { id: string; date: string; meal: Meal; item: Item; status: 'Planned' | 'Eaten' | 'Skipped'; batchId?: string | null };

export type PlanDay = {
  date: string;
  isPast: boolean;
  isToday: boolean;
  isUntracked: boolean;
  baseCalorieTarget: number;
  adjustedCalorieTarget: number;
  eaten: Nutrition;
  plannedRemaining: Nutrition;
  projected: Nutrition;
  planned: PlanEntry[];
  logged: DiaryEntry[];
};

export type Week = {
  weekStart: string;
  weekEnd: string;
  budgetMode: 'Daily' | 'Weekly';
  weeklyCalorieTarget: number;
  eatenSoFar: number;
  projectedTotal: number;
  unabsorbedCarryover: number;
  dailyTargets: Nutrition;
  days: PlanDay[];
};

export type RebalanceProposal = { date: string; adjustedTarget: number; plannedCalories: number; suggestedScale: number; affectedEntries: PlanEntry[] };

export type GapItem = { kind: 'Food' | 'Recipe'; foodId?: string | null; recipeId?: string | null; name: string; amount: number; unit: string; nutrition: Nutrition };
export type GapReport = {
  date: string;
  remaining: Nutrition;
  gaps: { nutrientId: number; name: string; unit: string; remaining: number; target: number; kind: string }[];
  suggestions: { items: GapItem[]; adds: Nutrition; remainingAfter: Nutrition; summary: string }[];
};

export type GroceryItem = { name: string; foodId?: string | null; totalGrams?: number | null; display: string; inPantry: boolean; usedIn: string[]; unconvertedAmounts: string[] };
export type GroceryList = { from: string; to: string; itemCount: number; aisles: { aisle: string; items: GroceryItem[] }[] };

export type RecipeSummary = {
  id: string;
  name: string;
  servings: number;
  origin: string;
  categories: string[];
  isFavorite: boolean;
  imageUrl?: string | null;
  hasPhoto: boolean;
  totalTime?: string | null;
  perServing: Nutrition;
  coverage: number;
  rating?: number | null;
};

export type Ingredient = {
  position: number;
  rawText: string;
  amount?: number | null;
  unit?: string | null;
  foodText: string;
  foodId?: string | null;
  foodName?: string | null;
  grams?: number | null;
  status: 'Unmatched' | 'AutoMatched' | 'Confirmed' | 'Ignored';
  matchConfidence: number;
  note?: string | null;
  nutrition?: Nutrition | null;
};

export type RecipeDetail = {
  summary: RecipeSummary;
  description?: string | null;
  directions?: string | null;
  notes?: string | null;
  sourceName?: string | null;
  sourceUrl?: string | null;
  sourceNutritionText?: string | null;
  ingredients: Ingredient[];
  warnings: string[];
};

export type ImportResult = { imported: number; updated: number; recipes: RecipeSummary[]; errors: string[] };

export type PantryItem = { id: string; name: string; foodId?: string | null; grams?: number | null; expiresOn?: string | null; isStaple: boolean };
export type Cookable = { recipe: RecipeSummary; matchPercent: number; have: string[]; missing: string[]; usesExpiringSoon: boolean };

export type HeatmapRow = { nutrientId: number; name: string; unit: string; kind: string; target: number; weeklyAveragePercent: number; days: { date: string; amount: number; percent?: number | null; level: string }[] };
export type Heatmap = { from: string; to: string; rows: HeatmapRow[]; highlights: string[] };

export type NutrientTarget = { nutrientId: number; name: string; unit: string; group: string; kind: string; target?: number | null; isCustom: boolean; isFocus: boolean };
export type Targets = {
  calories: number;
  proteinGrams: number;
  carbGrams: number;
  fatGrams: number;
  budgetMode: 'Daily' | 'Weekly';
  weekStartsOn: string;
  maxDailyAdjustment: number;
  nutrients: NutrientTarget[];
};

export type FoodMatch = { food: Food; score: number; quantity: { grams?: number | null; method: string; explanation: string }; nutrition?: Nutrition | null };
export type FoodMatchGroup = { text: string; amount?: number | null; unit?: string | null; foodQuery: string; matches: FoodMatch[] };
export type RecipeIdea = { name: string; description: string; servings: number; ingredients: string[]; directions: string; perServing: Nutrition; coverage: number; warnings: string[] };

export type AssistantResponse = {
  intent: string;
  reply: string;
  usedLanguageModel: boolean;
  meal?: Meal | null;
  date: string;
  foodMatches: FoodMatchGroup[];
  savedRecipes: RecipeSummary[];
  recipeIdeas: RecipeIdea[];
  cookable: Cookable[];
  gaps?: GapReport | null;
};
