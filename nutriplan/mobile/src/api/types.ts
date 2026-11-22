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
  /** Nutrients per 100 g, or per 100 ml when baseUnit is "ml" (drinks labelled by volume); portion grams are then ml. */
  per100g: Nutrition;
  portions: Portion[];
  baseUnit?: 'g' | 'ml';
};

/** A packaged product from USDA FoodData Central (not saved until opened). perServing only when the label gives a size. */
export type BrandedFood = {
  source: string; sourceId: string; name: string; brand?: string | null; barcode?: string | null; baseUnit: 'g' | 'ml';
  servingDescription?: string | null; servingAmount?: number | null; per100: Nutrition; perServing?: Nutrition | null;
  caloriesCalculated: boolean; caloriesMissing: boolean; localFoodId?: string | null; labelDate?: string | null;
};
export type BrandedResults = { results: BrandedFood[]; failure?: string | null; attribution: string };

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

/** missingFrom: entries that don't report this nutrient (unknown, not zero) — the amount is then a minimum. */
export type NutrientProgress = { nutrientId: number; name: string; unit: string; amount: number; target?: number | null; percent?: number | null; kind: 'Goal' | 'Limit'; missingFrom?: number };

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

export type GapItem = { kind: 'Food' | 'Recipe'; foodId?: string | null; recipeId?: string | null; name: string; amount: number; unit: string; nutrition: Nutrition; portion: string };
export type GapMode = 'BestMatch' | 'Meal' | 'QuickSnack' | 'Pantry' | 'SavedRecipes';
export type GapSituation = 'Open' | 'Near' | 'AtTarget' | 'Over';
export type GapReason = { code: string; text: string; nutrientId?: number | null };
export type GapEffect = { nutrientId: number; name: string; unit: string; kind: 'Goal' | 'Limit'; before: number; after: number };
export type GapSuggestion = { items: GapItem[]; adds: Nutrition; remainingAfter: Nutrition; summary: string; category: 'Meal' | 'Snack' | 'Side'; reasons: GapReason[]; effects: GapEffect[] };
export type GapSwap = { planEntryId: string; fromName: string; fromCalories: number; to: GapItem; savesCalories: number; reasons: GapReason[] };
export type GapTipItem = { kind: 'Food' | 'Recipe'; foodId?: string | null; recipeId?: string | null; name: string; portion: string; amount: number; unit: string; nutrientAmount: number; dailySharePercent: number };
export type GapTip = { nutrientId: number; name: string; unit: string; items: GapTipItem[] };
export type GapReport = {
  date: string;
  /** Signed: negative means over (calories, protein…). */
  remaining: Nutrition;
  gaps: { nutrientId: number; name: string; unit: string; remaining: number; target: number; kind: string; dataComplete: boolean }[];
  suggestions: GapSuggestion[];
  situation: GapSituation;
  message: string;
  mode: GapMode;
  availableModes: { mode: GapMode; count: number }[];
  emptyReason?: string | null;
  emptyMessage?: string | null;
  swaps: GapSwap[];
  nextDay: GapTip[];
  dataNotes: string[];
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
  servingDescription?: string | null;
  description?: string | null;
  directions?: string | null;
  notes?: string | null;
  sourceName?: string | null;
  sourceUrl?: string | null;
  sourceNutritionText?: string | null;
  prepTime?: string | null;
  cookTime?: string | null;
  /** Weight of the finished dish in grams, only when entered or supplied; never estimated. Enables per-100 g. */
  cookedWeightGrams?: number | null;
  ingredients: Ingredient[];
  warnings: string[];
};

export type ImportResult = { imported: number; updated: number; recipes: RecipeSummary[]; errors: string[] };

export type PantryItem = { id: string; name: string; foodId?: string | null; grams?: number | null; expiresOn?: string | null; isStaple: boolean };
export type Cookable = { recipe: RecipeSummary; matchPercent: number; have: string[]; missing: string[]; usesExpiringSoon: boolean };

/** missingFrom: entries that day with no value for the nutrient (the amount is a minimum). */
export type HeatmapCell = { date: string; amount: number; percent?: number | null; level: string; missingFrom?: number };
/**
 * Averages cover finished logged days only (before today): `completedDays` of them, `incompleteDays` with missing data.
 * `weeklyAveragePercent` is 0 and `averageAmount` null when there are none.
 */
export type HeatmapRow = {
  nutrientId: number; name: string; unit: string; kind: string; target: number; weeklyAveragePercent: number; days: HeatmapCell[];
  averageAmount?: number | null; completedDays?: number; incompleteDays?: number;
};
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

/** Given: the amount you said. Assumed: no amount, a standard USDA portion to confirm. NeedsAmount: you must choose one. */
export type QuantityStatus = 'Given' | 'Assumed' | 'NeedsAmount';
export type FoodMatch = {
  food: Food;
  score: number;
  quantity: { grams?: number | null; method: string; explanation: string; status: QuantityStatus };
  nutrition?: Nutrition | null;
  /** 0–1; below 0.5 the match deserves a look. */
  confidence: number;
  /** Raw / cooked state of this food, with a note when it matters and the id of the other state's entry. */
  preparation?: Preparation | null;
};
export type Preparation = { state: 'Raw' | 'Cooked' | 'Unspecified'; requested?: string | null; note?: string | null; otherFoodId?: string | null; otherState?: string | null };
export type FoodMatchGroup = { text: string; amount?: number | null; unit?: string | null; foodQuery: string; matches: FoodMatch[] };
export type RecipeIdea = { name: string; description: string; servings: number; ingredients: string[]; directions: string; perServing: Nutrition; coverage: number; warnings: string[] };

export type AssistantResponse = {
  intent: string;
  reply: string;
  usedLanguageModel: boolean;
  /** Which interpreter handled the request: Claude, Rules (Claude not configured) or RulesFallback (Claude failed). */
  interpreter?: 'Claude' | 'Rules' | 'RulesFallback';
  interpreterNote?: string | null;
  meal?: Meal | null;
  date: string;
  foodMatches: FoodMatchGroup[];
  savedRecipes: RecipeSummary[];
  recipeIdeas: RecipeIdea[];
  cookable: Cookable[];
  gaps?: GapReport | null;
};

/** One food for a multi-food log/plan request. */
export type FoodAmount = { foodId: string; grams?: number; amount?: number; unit?: string };

// ── Accounts ─────────────────────────────────────────────────────────────────────────────────────
export type AccessState = 'Active' | 'NotInvited' | 'Revoked' | 'EmailNotVerified';
export type Account = { id: string; displayName: string; email: string | null; role: 'Owner' | 'Member'; isActive: boolean; createdAt: string; lastLoginAt: string | null };
export type Session = { state: AccessState; message: string; user: Account | null; subject: string };
export type Invitation = { id: string; createdAt: string; expiresAt: string; accepted: boolean; revoked: boolean };
