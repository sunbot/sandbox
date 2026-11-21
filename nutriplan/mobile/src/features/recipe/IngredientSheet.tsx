import { useState } from 'react';
import { TextInput, View } from 'react-native';
import type { Ingredient } from '@/api/types';
import { AppText, Badge, BottomSheet, PrimaryButton, SecondaryButton } from '@/components/ds';
import { friendlyFoodName } from '@/lib/foodName';
import { useTheme } from '@/theme/ThemeProvider';
import { ingredientState, type IngredientState } from './nutritionView';

const stateWords: Record<IngredientState, string> = {
  header: '', matched: 'Auto-matched to a USDA food', confirmed: 'Confirmed by you', check: 'Check this match',
  unmatched: 'No USDA food matched', excluded: 'Left out of the calculation',
};

/**
 * Inspect one ingredient: what the recipe said, the food it is matched to, its amount and calories, with the existing
 * actions (choose a food, change the grams, leave it out). Nothing changes until you press an action.
 */
export function IngredientSheet({ ingredient, onClose, onChooseFood, onSetGrams, onLeaveOut, busy }: {
  ingredient: Ingredient | null;
  onClose: () => void;
  onChooseFood: (i: Ingredient) => void;
  onSetGrams: (i: Ingredient, grams: number) => void;
  onLeaveOut: (i: Ingredient) => void;
  busy?: boolean;
}) {
  const t = useTheme();
  const [last, setLast] = useState(ingredient);
  const [grams, setGrams] = useState('');
  const [editedFor, setEditedFor] = useState<number | null>(null);
  if (ingredient && ingredient !== last) setLast(ingredient);
  const ing = ingredient ?? last; // keep content while the sheet animates out
  if (ingredient && editedFor !== ingredient.position) { setEditedFor(ingredient.position); setGrams(ingredient.grams ? String(Math.round(ingredient.grams * 10) / 10) : ''); }
  if (!ing) return null;

  const state = ingredientState(ing);
  const value = Number(grams.replace(',', '.'));
  const validGrams = Number.isFinite(value) && value > 0;
  const changed = validGrams && Math.abs(value - (ing.grams ?? 0)) > 0.0001;

  return (
    <BottomSheet visible={!!ingredient} onClose={onClose} title="Ingredient"
      footer={<>
        <PrimaryButton label={ing.foodName ? 'Choose a different food' : 'Choose food'} onPress={() => onChooseFood(ing)} fullWidth />
        {state !== 'excluded' ? <SecondaryButton label="Leave out" onPress={() => onLeaveOut(ing)} loading={busy} fullWidth /> : null}
      </>}>
      <View style={{ gap: t.space.md }}>
        <AppText variant="body">{ing.rawText}</AppText>
        <Badge label={stateWords[state]} tone={state === 'confirmed' ? 'success' : state === 'unmatched' || state === 'check' ? 'warning' : 'neutral'} />
        {ing.foodName ? (
          <View style={{ gap: 2 }}>
            <AppText variant="label" tone="secondary">Matched food</AppText>
            <AppText variant="body">{friendlyFoodName(ing.foodName)}</AppText>
            {friendlyFoodName(ing.foodName) !== ing.foodName ? <AppText variant="caption" tone="muted">{ing.foodName}</AppText> : null}
          </View>
        ) : null}
        {ing.note ? <AppText variant="secondary" tone="secondary">{ing.note}</AppText> : null}
        {state !== 'excluded' && ing.foodName ? (
          <View style={{ gap: t.space.xs }}>
            <AppText variant="label" tone="secondary">Amount (grams){ing.nutrition ? ` · ${Math.round(ing.nutrition.calories)} kcal now` : ''}</AppText>
            <View style={{ flexDirection: 'row', gap: t.space.sm, alignItems: 'center' }}>
              <TextInput value={grams} onChangeText={setGrams} keyboardType="decimal-pad" placeholder="grams" placeholderTextColor={t.colors.textMuted}
                accessibilityLabel="Amount in grams"
                style={[t.type.bodyStrong, { flex: 1, minWidth: 0, minHeight: 48, paddingHorizontal: t.space.md, color: t.colors.text, borderRadius: t.radii.button, backgroundColor: t.colors.surfaceMuted }]} />
              <SecondaryButton label="Save amount" disabled={!changed} loading={busy} onPress={() => onSetGrams(ing, value)} />
            </View>
            {grams.trim() !== '' && !validGrams ? <AppText variant="caption" tone="error" accessibilityLiveRegion="polite">Enter a number above zero.</AppText> : null}
          </View>
        ) : null}
      </View>
    </BottomSheet>
  );
}
