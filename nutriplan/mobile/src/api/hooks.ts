import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { del, get, patch, post, put, q, api } from './client';
import { NUTRITION_KEYS } from './invalidation';
import type * as T from './types';
import { today, type Meal } from '@/lib/format';

// Query keys in one place so invalidation stays consistent.
export const keys = {
  day: (date: string) => ['day', date] as const,
  week: (date: string) => ['week', date] as const,
  quickLog: (meal?: Meal) => ['quickLog', meal ?? 'any'] as const,
  search: (text: string) => ['foodSearch', text] as const,
  food: (id: string) => ['food', id] as const,
  recipes: (search: string) => ['recipes', search] as const,
  recipe: (id: string) => ['recipe', id] as const,
  gaps: (date: string, mode: T.GapMode, meal?: Meal, exclude: readonly string[] = []) => ['gaps', date, mode, meal ?? 'any', exclude.join(',')] as const,
  grocery: (from: string, to: string) => ['grocery', from, to] as const,
  pantry: ['pantry'] as const,
  cookable: ['cookable'] as const,
  heatmap: (date: string) => ['heatmap', date] as const,
  targets: ['targets'] as const,
  rebalance: (date: string) => ['rebalance', date] as const,
};

/** Anything that changes what was eaten or planned invalidates the views that summarise it. */
function useInvalidateNutrition() {
  const qc = useQueryClient();
  return () => Promise.all(NUTRITION_KEYS.map((k) => qc.invalidateQueries({ queryKey: [k] })));
}

/** Header that makes a retried "Log all" / "Plan all" safe: the server returns the first result instead of saving twice. */
const once = (key?: string) => (key ? { 'Idempotency-Key': key } : undefined);

// ── Foods ─────────────────────────────────────────────────────────────
export const useFoodSearch = (text: string) =>
  useQuery({
    queryKey: keys.search(text),
    queryFn: () => get<T.Food[]>(`/foods/search?${q({ q: text, limit: 25 })}`),
    enabled: text.trim().length >= 2,
    staleTime: 60_000,
  });

/** USDA branded products; call with an already debounced query (it reaches an external service). */
export const useBrandedSearch = (text: string) =>
  useQuery({
    queryKey: ['brandedSearch', text.trim().toLowerCase()],
    queryFn: () => get<T.BrandedResults>(`/foods/branded?${q({ q: text.trim(), limit: 15 })}`),
    enabled: text.trim().length >= 3,
    staleTime: 10 * 60_000,
    retry: false,
  });

/** Saves a branded product (once) so it can be logged; returns the stored food. */
export const addBrandedFood = (sourceId: string) => post<T.Food>(`/foods/branded/${encodeURIComponent(sourceId)}`);

export const useFood = (id: string, enabled = true) => useQuery({ queryKey: keys.food(id), queryFn: () => get<T.Food>(`/foods/${id}`), enabled: enabled && !!id });

export const useNutrientCatalog = (enabled = true) =>
  useQuery({ queryKey: ['nutrientCatalog'], queryFn: () => get<T.NutrientDefinition[]>('/nutrients'), enabled, staleTime: Infinity });

export const lookupBarcode = (code: string) => get<T.Food>(`/foods/barcode/${encodeURIComponent(code)}`);

export const useCreateFood = () =>
  useMutation({
    mutationFn: (r: { name: string; brand?: string; barcode?: string; servingGrams: number; servingDescription?: string; nutrientsPerServing: Record<number, number> }) =>
      post<T.Food>('/foods', r),
  });

// ── Diary ─────────────────────────────────────────────────────────────
export const useDay = (date: string, enabled = true) => useQuery({ queryKey: keys.day(date), queryFn: () => get<T.Day>(`/diary/${date}`), enabled });

export const useQuickLog = (meal?: Meal) =>
  useQuery({ queryKey: keys.quickLog(meal), queryFn: () => get<T.QuickLogItem[]>(`/diary/quick-log?${q({ meal, limit: 12 })}`) });

/** Several foods for one meal, saved together (all or nothing). */
export function useLogFoods() {
  const invalidate = useInvalidateNutrition();
  return useMutation({
    mutationFn: ({ key, ...r }: { date: string; meal: Meal; items: T.FoodAmount[]; key?: string }) => post<T.DiaryEntry[]>('/diary/foods', r, once(key)),
    onSuccess: invalidate,
  });
}

export function useLogFood() {
  const invalidate = useInvalidateNutrition();
  return useMutation({
    mutationFn: (r: { date: string; meal: Meal; foodId: string; grams?: number; amount?: number; unit?: string }) => post<T.DiaryEntry>('/diary/food', r),
    onSuccess: invalidate,
  });
}

export function useLogRecipe() {
  const invalidate = useInvalidateNutrition();
  return useMutation({
    mutationFn: (r: { date: string; meal: Meal; recipeId: string; servings: number; amount?: number; unit?: string }) => post<T.DiaryEntry>('/diary/recipe', r),
    onSuccess: invalidate,
  });
}

export function useLogQuick() {
  const invalidate = useInvalidateNutrition();
  return useMutation({
    mutationFn: (r: { date: string; meal: Meal; name: string; calories: number; protein?: number; carbs?: number; fat?: number }) => post<T.DiaryEntry>('/diary/quick', r),
    onSuccess: invalidate,
  });
}

export function useUpdateEntry() {
  const invalidate = useInvalidateNutrition();
  return useMutation({
    mutationFn: ({ id, ...r }: { id: string; scale?: number; amount?: number; unit?: string; grams?: number; date?: string; meal?: Meal; note?: string }) => patch<T.DiaryEntry>(`/diary/${id}`, r),
    onSuccess: invalidate,
  });
}

export function useDeleteEntry() {
  const invalidate = useInvalidateNutrition();
  return useMutation({ mutationFn: (id: string) => del(`/diary/${id}`), onSuccess: invalidate });
}

export function useCopyMeal() {
  const invalidate = useInvalidateNutrition();
  return useMutation({
    mutationFn: (r: { from: string; to: string; meal?: Meal; toMeal?: Meal }) => post<T.DiaryEntry[]>('/diary/copy', r),
    onSuccess: invalidate,
  });
}

// ── Plan ──────────────────────────────────────────────────────────────
export const useWeek = (date: string) => useQuery({ queryKey: keys.week(date), queryFn: () => get<T.Week>(`/plan/week?${q({ date, today: today() })}`) });

export const useRebalance = (date: string) =>
  useQuery({ queryKey: keys.rebalance(date), queryFn: () => get<T.RebalanceProposal[]>(`/plan/rebalance?${q({ date, today: today() })}`) });

export function usePlanMutations() {
  const invalidate = useInvalidateNutrition();
  const opts = { onSuccess: invalidate };
  return {
    addFood: useMutation({
      mutationFn: (r: { date: string; meal: Meal; foodId: string; grams?: number; amount?: number; unit?: string }) => post<T.PlanEntry>('/plan/food', r),
      ...opts,
    }),
    addFoods: useMutation({
      mutationFn: ({ key, ...r }: { date: string; meal: Meal; items: T.FoodAmount[]; key?: string }) => post<T.PlanEntry[]>('/plan/foods', r, once(key)),
      ...opts,
    }),
    addRecipe: useMutation({
      mutationFn: (r: { date: string; meal: Meal; recipeId: string; servings: number; amount?: number; unit?: string }) => post<T.PlanEntry>('/plan/recipe', r),
      ...opts,
    }),
    addBatch: useMutation({
      mutationFn: (r: { recipeId: string; servingsPerPortion: number; slots: { date: string; meal: Meal }[] }) => post<T.PlanEntry[]>('/plan/batch', r),
      ...opts,
    }),
    eaten: useMutation({ mutationFn: ({ id, scale }: { id: string; scale?: number }) => post<T.DiaryEntry>(`/plan/${id}/eaten`, { scale: scale ?? 1, today: today() }), ...opts }),
    skip: useMutation({ mutationFn: (id: string) => post<T.PlanEntry>(`/plan/${id}/skip`), ...opts }),
    remove: useMutation({ mutationFn: (id: string) => del(`/plan/${id}`), ...opts }),
    move: useMutation({ mutationFn: ({ id, date, meal }: { id: string; date: string; meal: Meal }) => post<T.PlanEntry>(`/plan/${id}/move`, { date, meal }), ...opts }),
    rescale: useMutation({ mutationFn: ({ id, scale }: { id: string; scale: number }) => post<T.PlanEntry>(`/plan/${id}/rescale`, { scale }), ...opts }),
    applyRebalance: useMutation({ mutationFn: (r: { date: string; scale: number }) => post<T.PlanEntry[]>('/plan/rebalance', r), ...opts }),
    reopen: useMutation({ mutationFn: (id: string) => post<T.PlanEntry>(`/plan/${id}/reopen`), ...opts }),
    copy: useMutation({ mutationFn: (r: { from: string; to: string; meal?: Meal }) => post<T.PlanEntry[]>('/plan/copy', r), ...opts }),
    setAmount: useMutation({
      mutationFn: ({ id, amount, unit, grams }: { id: string; amount: number; unit: string; grams?: number }) => post<T.PlanEntry>(`/plan/${id}/amount`, { amount, unit, grams }),
      ...opts,
    }),
    swapFood: useMutation({
      mutationFn: ({ id, foodId, grams }: { id: string; foodId: string; grams: number }) => post<T.PlanEntry>(`/plan/${id}/swap-food`, { foodId, grams }),
      ...opts,
    }),
    swapRecipe: useMutation({
      mutationFn: ({ id, recipeId, servings }: { id: string; recipeId: string; servings: number }) => post<T.PlanEntry>(`/plan/${id}/swap-recipe`, { recipeId, servings }),
      ...opts,
    }),
  };
}

/** Keeps the previous answer on screen while a different mode or meal loads, so the chips and scroll position don't reset. */
/** `exclude`: ids of ideas already shown this session ("Show different ideas"); the server skips them. */
export const useGaps = (date: string, mode: T.GapMode = 'BestMatch', meal?: Meal, exclude: readonly string[] = []) =>
  useQuery({
    queryKey: keys.gaps(date, mode, meal, exclude),
    queryFn: () => get<T.GapReport>(`/plan/gaps?${q({ date, mode, meal, exclude: exclude.length ? exclude.join(',') : undefined })}`),
    placeholderData: keepPreviousData,
  });

export const useGrocery = (from: string, to: string) =>
  useQuery({ queryKey: keys.grocery(from, to), queryFn: () => get<T.GroceryList>(`/plan/grocery?${q({ from, to })}`) });

// ── Recipes ───────────────────────────────────────────────────────────
export const useRecipes = (search: string, enabled = true) =>
  useQuery({ queryKey: keys.recipes(search), queryFn: () => get<T.RecipeSummary[]>(`/recipes?${q({ search })}`), enabled });

export const useRecipe = (id: string, enabled = true) =>
  useQuery({ queryKey: keys.recipe(id), queryFn: () => get<T.RecipeDetail>(`/recipes/${id}`), enabled: enabled && !!id });

export function useRecipeMutations() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['recipes'] }).then(() => qc.invalidateQueries({ queryKey: ['recipe'] }));
  return {
    importUrl: useMutation({ mutationFn: (url: string) => post<T.RecipeDetail>('/recipes/import/url', { url }), onSuccess: refresh }),
    importPaprika: useMutation({
      mutationFn: (file: { uri: string; name: string; mimeType?: string; file?: File }) => {
        const form = new FormData();
        if (file.file) {
          // Web: the picker hands us a real File. (The { uri } shorthand below is React Native only; a browser would send "[object Object]".)
          form.append('file', file.file, file.name);
        } else {
          // React Native's FormData accepts { uri, name, type } file parts.
          form.append('file', { uri: file.uri, name: file.name, type: file.mimeType ?? 'application/octet-stream' } as unknown as Blob);
        }
        return api<T.ImportResult>('/recipes/import/paprika', { method: 'POST', body: form });
      },
      onSuccess: refresh,
    }),
    create: useMutation({
      mutationFn: (r: { name: string; servings: number; ingredients: string[]; directions?: string; description?: string; categories?: string[]; cookedWeightGrams?: number | null; finishedVolumeMl?: number | null }) =>
        post<T.RecipeDetail>('/recipes', r),
      onSuccess: refresh,
    }),
    edit: useMutation({
      mutationFn: ({ id, ...r }: { id: string; name: string; servings: number; ingredients: string[]; directions?: string | null; description?: string | null; categories?: string[]; notes?: string | null; cookedWeightGrams?: number | null; finishedVolumeMl?: number | null }) =>
        put<T.RecipeDetail>(`/recipes/${id}`, r),
      onSuccess: refresh,
    }),
    favorite: useMutation({ mutationFn: ({ id, favorite }: { id: string; favorite: boolean }) => post(`/recipes/${id}/favorite`, { favorite }), onSuccess: refresh }),
    addIngredient: useMutation({
      mutationFn: ({ id, ...r }: { id: string; foodId?: string; recipeId?: string; amount?: number; unit?: string; grams?: number; servings?: number }) =>
        post<T.RecipeDetail>(`/recipes/${id}/ingredients`, r),
      onSuccess: refresh,
    }),
    removeIngredient: useMutation({
      mutationFn: ({ id, position }: { id: string; position: number }) => api<T.RecipeDetail>(`/recipes/${id}/ingredients/${position}`, { method: 'DELETE' }),
      onSuccess: refresh,
    }),
    scale: useMutation({
      mutationFn: ({ id, factor }: { id: string; factor: number }) => post<T.RecipeDetail>(`/recipes/${id}/scale`, { factor }),
      onSuccess: refresh,
    }),
    updateIngredient: useMutation({
      mutationFn: ({ id, position, ...r }: { id: string; position: number; foodId?: string; recipeId?: string; servings?: number; grams?: number; amount?: number; unit?: string; ignore?: boolean }) =>
        put<T.RecipeDetail>(`/recipes/${id}/ingredients/${position}`, r),
      onSuccess: refresh,
    }),
    remove: useMutation({ mutationFn: (id: string) => del(`/recipes/${id}`), onSuccess: refresh }),
    setServings: useMutation({ mutationFn: ({ id, servings }: { id: string; servings: number }) => put<T.RecipeDetail>(`/recipes/${id}/servings`, { servings }), onSuccess: refresh }),
    rematch: useMutation({ mutationFn: (id: string) => post<T.RecipeDetail>(`/recipes/${id}/rematch`), onSuccess: refresh }),
  };
}

// ── Pantry ────────────────────────────────────────────────────────────
export const usePantry = () => useQuery({ queryKey: keys.pantry, queryFn: () => get<T.PantryItem[]>('/pantry') });
export const useCookable = () => useQuery({ queryKey: keys.cookable, queryFn: () => get<T.Cookable[]>('/pantry/what-can-i-make') });

export function usePantryMutations() {
  const qc = useQueryClient();
  const refresh = () => Promise.all(['pantry', 'cookable', 'grocery'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
  return {
    add: useMutation({ mutationFn: (r: { name: string; foodId?: string; grams?: number; expiresOn?: string; isStaple?: boolean }) => post<T.PantryItem>('/pantry', r), onSuccess: refresh }),
    remove: useMutation({ mutationFn: (id: string) => del(`/pantry/${id}`), onSuccess: refresh }),
    update: useMutation({
      mutationFn: ({ id, ...r }: { id: string; name: string; foodId?: string | null; grams?: number | null; expiresOn?: string | null; isStaple: boolean }) => put<T.PantryItem>(`/pantry/${id}`, r),
      onSuccess: refresh,
    }),
  };
}

export function useGroceryExclusions() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['grocery'] });
  return {
    hide: useMutation({ mutationFn: (r: { key: string; name: string }) => post<void>('/plan/grocery/exclusions', r), onSuccess: refresh }),
    restore: useMutation({ mutationFn: (key?: string) => del(`/plan/grocery/exclusions${key ? `?${q({ key })}` : ''}`), onSuccess: refresh }),
  };
}

// ── Insights, targets, assistant ──────────────────────────────────────
export const useHeatmap = (date: string) => useQuery({ queryKey: keys.heatmap(date), queryFn: () => get<T.Heatmap>(`/insights/heatmap?${q({ date, today: today() })}`) });

export const useTargets = () => useQuery({ queryKey: keys.targets, queryFn: () => get<T.Targets>('/targets') });

export function useUpdateTargets() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (r: Partial<Pick<T.Targets, 'calories' | 'proteinGrams' | 'carbGrams' | 'fatGrams' | 'budgetMode' | 'weekStartsOn' | 'maxDailyAdjustment'>> & { nutrientOverrides?: Record<number, number | null>; focusNutrients?: number[] }) =>
      put<T.Targets>('/targets', r),
    onSuccess: () => Promise.all(['targets', 'day', 'week', 'gaps', 'heatmap'].map((k) => qc.invalidateQueries({ queryKey: [k] }))),
  });
}

export const useAssistant = () => useMutation({ mutationFn: (r: { text: string; date: string }) => post<T.AssistantResponse>('/assistant', r) });

export const useStatus = () => useQuery({ queryKey: ['status'], queryFn: () => get<{ languageModel: boolean; foods: number }>('/status') });
