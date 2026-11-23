import { useState } from 'react';
import { View } from 'react-native';
import { useFood } from '@/api/hooks';
import type { Ingredient } from '@/api/types';
import { AppText, Badge, BottomSheet, PrimaryButton, SecondaryButton, TextButton } from '@/components/ds';
import { ChefHat, Trash2 } from '@/components/ds/icons';
import { QuantityPicker, type QuantityValue } from '@/features/quantity/QuantityPicker';
import { checkQuantity, ingredientSelection, MAX_INGREDIENT_GRAMS, matchMeasure, parseQuantity, roundAmount } from '@/features/quantity/quantity';
import { friendlyFoodName } from '@/lib/foodName';
import { useTheme } from '@/theme/ThemeProvider';
import { recipeAmount } from './IngredientNutritionRow';
import { ingredientState, type IngredientState } from './nutritionView';

const stateWords: Record<IngredientState, string> = {
  header: '', matched: 'Auto-matched to a USDA food', confirmed: 'Confirmed by you', check: 'Check this match',
  unmatched: 'No USDA food matched', excluded: 'Left out of the calculation',
};

/**
 * Inspect one ingredient: what the recipe said, the food (or recipe) it is matched to, its amount and calories, with
 * actions: change the amount in the food's own measures, choose another food or recipe, leave it out, or remove the line.
 * Nothing changes until you press an action.
 */
export function IngredientSheet({ ingredient, onClose, onChooseFood, onSetAmount, onLeaveOut, onRemove, onRecipeAmount, onOpenRecipe, busy, footerExtra }: {
  ingredient: Ingredient | null;
  onClose: () => void;
  onChooseFood: (i: Ingredient) => void;
  /** A food line's new amount in one of its measures (the server converts it to grams). */
  onSetAmount: (i: Ingredient, amount: number, unit: string) => void;
  onLeaveOut: (i: Ingredient) => void;
  /** Removes the line for good (Leave out keeps it, uncounted). */
  onRemove?: (i: Ingredient) => void;
  /** For a line that is one of your recipes: change how much of it (in its servings, or grams/cups when known). */
  onRecipeAmount?: (i: Ingredient) => void;
  onOpenRecipe?: (recipeId: string) => void;
  busy?: boolean;
  /** Extra footer content (the review flow's "Next"). */
  footerExtra?: React.ReactNode;
}) {
  const t = useTheme();
  const [last, setLast] = useState(ingredient);
  if (ingredient && ingredient !== last) setLast(ingredient);
  const ing = ingredient ?? last; // keep content while the sheet animates out
  // The editor belongs to one line: reopening (or the next line in review) starts from that line's saved amount.
  const [edit, setEdit] = useState<{ position: number; value: QuantityValue } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<number | null>(null);
  // Closing the sheet, or opening another line (also the one that moved into this position after a removal), starts fresh:
  // no unsaved amount carried over, and Remove asks again.
  const openKey = ingredient ? `${ingredient.position}:${ingredient.rawText}` : null;
  const [lastKey, setLastKey] = useState(openKey);
  if (openKey !== lastKey) { setLastKey(openKey); setEdit(null); setConfirmRemove(null); }
  const food = useFood(ing?.foodId ?? '', !!ingredient && !!ing?.foodId && !ing?.recipeId);
  if (!ing) return null;

  const state = ingredientState(ing);
  const measures = food.data?.measures ?? [];
  const value = edit?.position === ing.position ? edit.value : measures.length ? ingredientSelection(ing, measures) : null;
  const measure = value ? matchMeasure(measures, value.unit) : undefined;
  const qty = value ? parseQuantity(value.text) : null;
  const check = checkQuantity(qty, measure, false, 'g', MAX_INGREDIENT_GRAMS);
  const start = measures.length ? ingredientSelection(ing, measures) : null;
  const changed = !!value && !!start && (value.text !== start.text || value.unit !== start.unit);
  const removing = confirmRemove === ing.position;

  return (
    <BottomSheet visible={!!ingredient} onClose={onClose} title="Ingredient" steadyKey={`ingredient:${ing.position}:${ing.recipeId ? 'recipe' : food.data ? 'measures' : 'loading'}`}
      footer={<>
        {footerExtra}
        {ing.recipeId && state !== 'excluded' && onRecipeAmount ? <PrimaryButton label="Change amount" onPress={() => onRecipeAmount(ing)} fullWidth /> : null}
        {ing.recipeId || (ing.foodName && state !== 'excluded') ? <SecondaryButton label="Choose a different food or recipe" onPress={() => onChooseFood(ing)} fullWidth />
          : <PrimaryButton label={ing.foodName ? 'Choose a different food or recipe' : 'Choose a food or recipe'} onPress={() => onChooseFood(ing)} fullWidth />}
        <View style={{ flexDirection: 'row', gap: t.space.sm }}>
          {state !== 'excluded' ? <SecondaryButton label="Leave out" onPress={() => onLeaveOut(ing)} loading={busy} disabled={busy} style={{ flex: 1 }} /> : null}
          {onRemove ? (
            <SecondaryButton label={removing ? 'Tap again to remove' : 'Remove line'} icon={Trash2} tone="danger" style={{ flex: 1 }} disabled={busy}
              onPress={() => { if (removing) { setConfirmRemove(null); onRemove(ing); } else setConfirmRemove(ing.position); }} />
          ) : null}
        </View>
      </>}>
      <View style={{ gap: t.space.md }}>
        <AppText variant="body">{ing.rawText}</AppText>
        <View style={{ flexDirection: 'row' }}>
          <Badge label={stateWords[state]} tone={state === 'confirmed' ? 'success' : state === 'unmatched' || state === 'check' ? 'warning' : 'neutral'} />
        </View>
        {ing.recipeId ? (
          <View style={{ gap: 2 }}>
            <AppText variant="label" tone="secondary">Your recipe</AppText>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm, flexWrap: 'wrap' }}>
              <ChefHat size={20} strokeWidth={1.8} color={t.colors.textMuted} />
              <AppText variant="body" style={{ flexShrink: 1 }}>{ing.recipeName ?? 'Recipe'}</AppText>
            </View>
            <AppText variant="secondary" tone="secondary">{recipeAmount(ing)}{ing.nutrition ? ` · ${Math.round(ing.nutrition.calories)} kcal` : ''}</AppText>
            {onOpenRecipe ? <View style={{ flexDirection: 'row' }}><TextButton label="Open this recipe" onPress={() => onOpenRecipe(ing.recipeId!)} /></View> : null}
          </View>
        ) : null}
        {ing.foodName ? (
          <View style={{ gap: 2 }}>
            <AppText variant="label" tone="secondary">Matched food</AppText>
            <AppText variant="body">{friendlyFoodName(ing.foodName)}</AppText>
            {friendlyFoodName(ing.foodName) !== ing.foodName ? <AppText variant="caption" tone="muted">{ing.foodName}</AppText> : null}
          </View>
        ) : null}
        {ing.note ? <AppText variant="secondary" tone="secondary">{ing.note}</AppText> : null}
        {state !== 'excluded' && ing.foodName && !ing.recipeId ? (
          <View style={{ gap: t.space.sm }}>
            <AppText variant="label" tone="secondary">
              Amount{ing.grams ? ` · ${Math.round(ing.grams)} g` : ''}{ing.nutrition ? ` · ${Math.round(ing.nutrition.calories)} kcal now` : ''}
            </AppText>
            {value && measures.length ? (
              <>
                <QuantityPicker measures={measures} value={{ text: value.text, unit: measure?.unit ?? value.unit }} baseUnit="g"
                  onChange={(v) => setEdit({ position: ing.position, value: v })} error={qty !== null && !check.ok ? check.message : null}
                  onSubmit={() => { if (check.ok && changed && !busy) onSetAmount(ing, roundAmount(qty!), measure!.unit); }} />
                <SecondaryButton label="Save amount" disabled={!changed || !check.ok || busy} loading={busy}
                  onPress={() => onSetAmount(ing, roundAmount(qty!), measure!.unit)} fullWidth />
              </>
            ) : (
              <AppText variant="secondary" tone="secondary">{food.isError ? 'Couldn’t load this food’s measures.' : 'Loading measures…'}</AppText>
            )}
          </View>
        ) : null}
      </View>
    </BottomSheet>
  );
}
