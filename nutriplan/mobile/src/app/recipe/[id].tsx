import { useState } from 'react';
import { Alert, Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useLogRecipe, usePlanMutations, useRecipe, useRecipeMutations } from '@/api/hooks';
import type { Ingredient } from '@/api/types';
import { MacroLine } from '@/components/charts';
import { Button, Card, Chip, ErrorView, Field, Loading } from '@/components/ui';
import { addDays, dayLabel, mealForNow, meals, type Meal, today } from '@/lib/format';
import { colors, font, spacing } from '@/lib/theme';

/**
 * Recipe nutrition is computed from each ingredient's matched food and grams. Low-confidence or
 * unmatched lines are highlighted so you can fix them; the per-serving numbers update immediately.
 */
export default function RecipeScreen() {
  const { id, planDate } = useLocalSearchParams<{ id: string; planDate?: string }>();
  const recipe = useRecipe(id);
  const m = useRecipeMutations();
  const plan = usePlanMutations();
  const logRecipe = useLogRecipe();
  const [servings, setServings] = useState('1');
  const [meal, setMeal] = useState<Meal>('Dinner');
  const [batchDays, setBatchDays] = useState('3');

  if (recipe.isLoading) return <Loading />;
  if (recipe.error) return <ErrorView error={recipe.error} />;
  const r = recipe.data!;
  const s = r.summary;
  const n = Number(servings) || 1;

  const addToPlan = async () => {
    await plan.addRecipe.mutateAsync({ date: planDate ?? today(), meal, recipeId: s.id, servings: n });
    router.back();
  };

  const batch = async () => {
    const days = Math.max(1, Math.min(7, Number(batchDays) || 1));
    const start = planDate ?? today();
    await plan.addBatch.mutateAsync({ recipeId: s.id, servingsPerPortion: n, slots: Array.from({ length: days }, (_, i) => ({ date: addDays(start, i), meal })) });
    Alert.alert('Planned', `${days} portions of ${s.name}, ${meal.toLowerCase()} from ${dayLabel(start)}. It's on the grocery list once.`);
  };

  const fixIngredient = (ing: Ingredient) =>
    Alert.alert(ing.rawText, ing.note ?? undefined, [
      { text: 'Choose food', onPress: () => router.push({ pathname: '/food/search', params: { mode: 'ingredient', recipeId: s.id, position: String(ing.position) } }) },
      { text: 'Exclude', onPress: () => m.updateIngredient.mutate({ id: s.id, position: ing.position, ignore: true }) },
      { text: 'Cancel', style: 'cancel' },
    ]);

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={font.title}>{s.name}</Text>
      {r.description ? <Text style={font.small}>{r.description}</Text> : null}

      <Card style={{ gap: spacing.xs }}>
        <Text style={font.small}>Per serving · makes {s.servings}</Text>
        <MacroLine n={s.perServing} />
        <Text style={font.tiny}>Fiber {s.perServing.fiber.toFixed(1)} g · calculated from {Math.round(s.coverage * 100)}% of ingredients{s.coverage < 1 ? ' (fix the highlighted ones)' : ''}</Text>
        {r.sourceNutritionText ? <Text style={font.tiny}>Source says: {r.sourceNutritionText}</Text> : null}
      </Card>

      <Card style={{ gap: spacing.md }}>
        <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'flex-end' }}>
          <View style={{ width: 90 }}><Field label="Servings" value={servings} onChangeText={setServings} keyboardType="decimal-pad" /></View>
          <Text style={[font.small, { flex: 1 }]}>{Math.round(s.perServing.calories * n)} kcal</Text>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          {meals.map((x) => <Chip key={x} label={x} selected={x === meal} onPress={() => setMeal(x)} />)}
        </View>
        <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
          <Button title={planDate ? `Plan for ${dayLabel(planDate)}` : 'Plan for today'} compact onPress={addToPlan} loading={plan.addRecipe.isPending} />
          <Button title="Log now" variant="secondary" compact loading={logRecipe.isPending}
            onPress={async () => { await logRecipe.mutateAsync({ date: today(), meal: mealForNow(), recipeId: s.id, servings: n }); Alert.alert('Logged'); }} />
          <Button title={s.isFavorite ? '★ Favorite' : '☆ Favorite'} variant="ghost" compact onPress={() => m.favorite.mutate({ id: s.id, favorite: !s.isFavorite })} />
        </View>
        <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-end' }}>
          <View style={{ width: 90 }}><Field label="Batch days" value={batchDays} onChangeText={setBatchDays} keyboardType="number-pad" /></View>
          <Button title="Cook once, plan leftovers" variant="secondary" compact onPress={batch} loading={plan.addBatch.isPending} />
        </View>
      </Card>

      <Card>
        <Text style={[font.heading, { marginBottom: spacing.sm }]}>Ingredients</Text>
        {r.ingredients.map((ing) => {
          const header = ing.status === 'Ignored' && ing.note === 'Section header';
          const needsAttention = ing.status === 'Unmatched' || (ing.status === 'AutoMatched' && (ing.grams == null || ing.matchConfidence < 0.5));
          return (
            <View key={ing.position} style={[styles.ing, needsAttention && styles.attention]}>
              <Text style={[header ? font.heading : font.body, { fontSize: header ? 14 : 15 }]} onPress={header ? undefined : () => fixIngredient(ing)}>
                {ing.rawText}
              </Text>
              {!header && (
                <Text style={font.tiny} onPress={() => fixIngredient(ing)}>
                  {ing.status === 'Ignored' ? `Not counted · ${ing.note ?? ''}` : ing.foodName ? `→ ${ing.foodName}${ing.grams ? ` · ${Math.round(ing.grams)} g` : ''}${ing.nutrition ? ` · ${Math.round(ing.nutrition.calories)} kcal` : ''}` : 'Tap to choose a food'}
                  {needsAttention && ing.note ? `\n${ing.note}` : ''}
                </Text>
              )}
            </View>
          );
        })}
      </Card>

      {r.directions ? (
        <Card><Text style={[font.heading, { marginBottom: spacing.sm }]}>Directions</Text><Text style={[font.body, { lineHeight: 22 }]}>{r.directions}</Text></Card>
      ) : null}
      {r.sourceUrl ? <Button title={`Open ${r.sourceName ?? 'source'}`} variant="ghost" onPress={() => Linking.openURL(r.sourceUrl!)} /> : null}
      <Button title="Delete recipe" variant="danger" onPress={() => Alert.alert('Delete recipe?', s.name, [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: async () => { await m.remove.mutateAsync(s.id); router.back(); } }])} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl },
  ing: { paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, gap: 2 },
  attention: { backgroundColor: '#fff7e6', marginHorizontal: -spacing.sm, paddingHorizontal: spacing.sm, borderRadius: 6 },
});
