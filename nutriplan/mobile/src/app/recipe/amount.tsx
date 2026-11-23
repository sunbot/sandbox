import { useState } from 'react';
import { Keyboard, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useLogRecipe, usePlanMutations, useRecipe, useRecipeMutations } from '@/api/hooks';
import { AppCard, AppText, Badge, EmptyState, FilterChip, PrimaryButton, SecondaryButton, Skeleton, TextButton, useSnackbar } from '@/components/ds';
import { ChefHat, CircleAlert } from '@/components/ds/icons';
import { QuantityPicker, type QuantityValue } from '@/features/quantity/QuantityPicker';
import { checkQuantity, matchMeasure, parseQuantity, roundAmount, SERVING } from '@/features/quantity/quantity';
import { eatingNutrition, servingsWord } from '@/features/recipe/nutritionView';
import { dayLabel, mealForNow, meals, type Meal, today } from '@/lib/format';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * How much of one of your recipes: log it, plan it, or use it as an ingredient of another recipe. Amounts are in the
 * recipe's own measures: servings always, grams or cups only when you entered its finished weight or volume (never estimated).
 * Nutrition is servings × the recipe's per-serving numbers, which come from its ingredients.
 */
export default function RecipeAmount() {
  const t = useTheme();
  const snackbar = useSnackbar();
  const params = useLocalSearchParams<{ id: string; date?: string; meal?: Meal; mode?: 'log' | 'plan' | 'ingredient'; recipeId?: string; position?: string }>();
  const recipe = useRecipe(params.id);
  const logRecipe = useLogRecipe();
  const { addRecipe } = usePlanMutations();
  const { updateIngredient } = useRecipeMutations();
  const [meal, setMeal] = useState<Meal>(params.meal ?? mealForNow());
  const [value, setValue] = useState<QuantityValue | null>(null);
  const forIngredient = params.mode === 'ingredient' && !!params.recipeId && !!params.position;
  const planning = params.mode === 'plan';
  const date = params.date ?? today();

  if (recipe.isLoading) return <View style={{ padding: t.screenPadding, gap: t.space.md }}><Skeleton width="100%" height={72} /><Skeleton width="100%" height={180} radius={20} /></View>;
  if (recipe.error || !recipe.data) {
    return <EmptyState icon={ChefHat} title="Couldn’t load this recipe" body={recipe.error instanceof Error ? recipe.error.message : 'Check your connection and try again.'}
      action={<SecondaryButton label="Try again" onPress={() => recipe.refetch()} />} />;
  }

  const r = recipe.data;
  const s = r.summary;
  const measures = r.measures?.length ? r.measures : [SERVING];
  const v = value ?? { text: '1', unit: 'serving' };
  const measure = matchMeasure(measures, v.unit) ?? measures[0];
  const qty = parseQuantity(v.text);
  const check = checkQuantity(qty, measure, true, 'serving');
  const servings = check.ok ? check.base : 0;
  const n = eatingNutrition(s.perServing, servings);
  const busy = logRecipe.isPending || addRecipe.isPending || updateIngredient.isPending;

  const save = async () => {
    if (!check.ok) return snackbar({ message: check.message });
    if (busy) return;
    Keyboard.dismiss();
    // The measure is sent as chosen ("1.5 cup"), so the entry reads the way it was given; the server converts it to servings.
    const amount = { amount: roundAmount(qty!), unit: measure.unit };
    try {
      if (forIngredient) {
        await updateIngredient.mutateAsync({ id: params.recipeId!, position: Number(params.position), recipeId: s.id, ...amount });
        router.dismissTo({ pathname: '/recipe/[id]', params: { id: params.recipeId! } });
        return;
      }
      const body = { date, meal, recipeId: s.id, servings: roundAmount(servings), ...amount };
      if (planning) await addRecipe.mutateAsync(body);
      else await logRecipe.mutateAsync(body);
      router.dismissAll();
    } catch (e) {
      snackbar({ message: e instanceof Error ? e.message : 'Could not save' });
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: t.screenPadding, gap: t.space.lg, paddingBottom: t.space.huge }} keyboardShouldPersistTaps="handled">
      <View style={{ gap: t.space.xs }}>
        <AppText variant="pageTitle" accessibilityRole="header">{s.name}</AppText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space.xs }}>
          <Badge label="Your recipe" icon={ChefHat} />
          {s.coverage < 1 ? <Badge label={`${Math.round(s.coverage * 100)}% of ingredients counted`} tone="warning" icon={CircleAlert} /> : null}
        </View>
        <AppText variant="secondary" tone="secondary">Makes {servingsWord(s.servings)} · {Math.round(s.perServing.calories)} kcal per serving</AppText>
      </View>

      <AppCard style={{ gap: t.space.md }}>
        <QuantityPicker measures={measures} value={{ text: v.text, unit: measure.unit }} baseUnit="serving" onChange={setValue}
          error={qty !== null && !check.ok ? check.message : null} onSubmit={save} />
        <AppText variant="body" tone="secondary" numeric accessibilityLiveRegion="polite">
          {check.ok ? `${Math.round(n.calories)} kcal · P ${Math.round(n.protein)} g · C ${Math.round(n.carbs)} g · F ${Math.round(n.fat)} g` : ' '}
        </AppText>
      </AppCard>

      {!forIngredient ? (
        <View style={{ gap: t.space.sm }}>
          <AppText variant="label" tone="secondary">{planning ? 'Plan for' : 'Log to'} · {dayLabel(date)}</AppText>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space.sm }}>
            {meals.map((m) => <FilterChip key={m} label={m === 'Snack' ? 'Snacks' : m} selected={m === meal} onPress={() => setMeal(m)} />)}
          </View>
        </View>
      ) : (
        <AppText variant="secondary" tone="secondary">
          Counted with this recipe’s current nutrition. If you change it later, recipes that use it update too; meals you already logged don’t.
        </AppText>
      )}

      <PrimaryButton label={forIngredient ? 'Use as this ingredient' : planning ? 'Add to plan' : `Add · ${Math.round(n.calories)} kcal`}
        onPress={save} loading={busy} disabled={!check.ok || busy} fullWidth />
      <TextButton label="Open recipe" tone="secondary" onPress={() => router.push({ pathname: '/recipe/[id]', params: { id: s.id } })} />
    </ScrollView>
  );
}
