import { Pressable, View } from 'react-native';
import type { Ingredient } from '@/api/types';
import { AppText, Badge } from '@/components/ds';
import { ChefHat, ChevronRight, Check, CircleAlert, CircleMinus } from '@/components/ds/icons';
import { friendlyFoodName } from '@/lib/foodName';
import { useTheme } from '@/theme/ThemeProvider';
import { ingredientState, type IngredientState } from './nutritionView';

const badge: Partial<Record<IngredientState, { label: string; tone: 'warning' | 'success' | 'neutral'; icon: typeof Check }>> = {
  unmatched: { label: 'No match', tone: 'warning', icon: CircleAlert },
  check: { label: 'Check match', tone: 'warning', icon: CircleAlert },
  excluded: { label: 'Left out', tone: 'neutral', icon: CircleMinus },
  confirmed: { label: 'Confirmed', tone: 'success', icon: Check },
};

/** One ingredient: what the recipe said, the USDA food it was matched to, the amount, and its calories. */
export function IngredientNutritionRow({ ingredient: ing, onPress }: { ingredient: Ingredient; onPress: () => void }) {
  const t = useTheme();
  const state = ingredientState(ing);

  if (state === 'header') {
    return <AppText variant="label" tone="secondary" style={{ paddingTop: t.space.md, paddingBottom: t.space.xs }} accessibilityRole="header">{ing.rawText}</AppText>;
  }

  const kcal = ing.nutrition ? Math.round(ing.nutrition.calories) : null;
  const matched = ing.recipeId ? `Your recipe: ${ing.recipeName ?? 'recipe'} · ${recipeAmount(ing)}`
    : ing.foodName ? `${friendlyFoodName(ing.foodName)}${ing.grams ? ` · ${Math.round(ing.grams)} g` : ''}` : null;
  const detail = state === 'excluded' ? `Not counted${ing.note ? ` · ${ing.note}` : ''}`
    : state === 'unmatched' ? 'No food matched. Tap to choose one.'
    : matched ?? 'Tap to choose a food';
  const b = badge[state];

  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityHint="Change the food or amount, or leave it out"
      accessibilityLabel={`${ing.rawText}. ${detail}${kcal != null ? `. ${kcal} calories` : ''}${b ? `. ${b.label}` : ''}`}
      style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: t.space.md, minHeight: 60, paddingVertical: t.space.sm, borderTopWidth: 1, borderTopColor: t.colors.border }, pressed && { backgroundColor: t.colors.surfaceMuted }]}>
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="body" numberOfLines={3} style={state === 'excluded' ? { textDecorationLine: 'line-through', color: t.colors.textMuted } : undefined}>{ing.rawText}</AppText>
        <AppText variant="secondary" tone="secondary" numberOfLines={2}>{state === 'matched' || state === 'confirmed' || state === 'check' ? '→ ' : ''}{detail}</AppText>
        {state === 'check' && ing.note ? <AppText variant="caption" tone="warning" numberOfLines={3}>{ing.note}</AppText> : null}
        {b || ing.recipeId ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space.xs, marginTop: 2 }}>
            {ing.recipeId && state !== 'excluded' ? <Badge label="Recipe" icon={ChefHat} /> : null}
            {b ? <Badge label={b.label} tone={b.tone} icon={b.icon} /> : null}
          </View>
        ) : null}
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <AppText variant="bodyStrong" numeric>{kcal ?? '–'}</AppText>
        <AppText variant="caption" tone="muted">kcal</AppText>
      </View>
      <ChevronRight size={18} strokeWidth={1.8} color={t.colors.textMuted} />
    </Pressable>
  );
}

/** How much of a nested recipe a line uses: "1.5 servings", plus its weight when the recipe's finished weight is known. */
export function recipeAmount(ing: Pick<Ingredient, 'servings' | 'grams'>): string {
  const sv = ing.servings ?? 0;
  const servings = `${Math.round(sv * 100) / 100} serving${sv === 1 ? '' : 's'}`;
  return ing.grams ? `${servings} (${Math.round(ing.grams)} g)` : servings;
}
