import { useState } from 'react';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
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
  // Everything below shows on the screen rather than in alerts, which don't appear in the web version.
  const [notice, setNotice] = useState<string | null>(null);
  const [openIng, setOpenIng] = useState<number | null>(null);
  const [yieldText, setYieldText] = useState<string | null>(null); // non-null while editing "makes N servings"
  const [confirmDelete, setConfirmDelete] = useState(false);

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
    setNotice(`Planned ${days} portions of ${s.name}, ${meal.toLowerCase()} from ${dayLabel(start)}. It's on the grocery list once.`);
  };

  const fixIngredient = (ing: Ingredient) => setOpenIng((p) => (p === ing.position ? null : ing.position));

  const saveYield = async () => {
    const v = Number(yieldText);
    if (!(v > 0)) return setNotice('Enter how many servings the whole recipe makes.');
    try {
      await m.setServings.mutateAsync({ id: s.id, servings: v });
      setYieldText(null);
      setNotice(`Now ${v} serving${v === 1 ? '' : 's'}: per-serving numbers updated.`);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  };

  const refreshMatches = async () => {
    try {
      const d = await m.rematch.mutateAsync(s.id);
      setNotice(`Ingredients re-matched: ${Math.round(d.summary.coverage * 100)}% now counted. Lines you chose or excluded were kept.`);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={font.title}>{s.name}</Text>
      {r.description ? <Text style={font.small}>{r.description}</Text> : null}

      {notice ? (
        <View accessibilityLiveRegion="polite" style={styles.notice}>
          <Text style={[font.body, { flex: 1 }]}>{notice}</Text>
          <Button title="OK" variant="ghost" compact onPress={() => setNotice(null)} />
        </View>
      ) : null}

      <Card style={{ gap: spacing.xs }}>
        {yieldText === null ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' }}>
            <Text style={font.small}>Per serving · whole recipe makes {s.servings} serving{s.servings === 1 ? '' : 's'}</Text>
            <Button title="Change" variant="ghost" compact onPress={() => setYieldText(String(s.servings))} />
          </View>
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, flexWrap: 'wrap' }}>
            <View style={{ width: 110 }}><Field label="Recipe makes" value={yieldText} onChangeText={setYieldText} keyboardType="decimal-pad" /></View>
            <Button title="Save" compact onPress={saveYield} loading={m.setServings.isPending} />
            <Button title="Cancel" variant="ghost" compact onPress={() => setYieldText(null)} />
          </View>
        )}
        {s.servings === 1 && !r.servingDescription && yieldText === null ? (
          <Text style={[font.tiny, { color: colors.high }]}>The recipe didn’t say how many servings it makes, so this is the whole recipe. Tap Change to set it.</Text>
        ) : null}
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
            onPress={async () => { await logRecipe.mutateAsync({ date: today(), meal: mealForNow(), recipeId: s.id, servings: n }); setNotice(`Logged ${n} serving${n === 1 ? '' : 's'} to ${mealForNow().toLowerCase()} today.`); }} />
          <Button title={s.isFavorite ? '★ Favorite' : '☆ Favorite'} variant="ghost" compact onPress={() => m.favorite.mutate({ id: s.id, favorite: !s.isFavorite })} />
        </View>
        <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-end' }}>
          <View style={{ width: 90 }}><Field label="Batch days" value={batchDays} onChangeText={setBatchDays} keyboardType="number-pad" /></View>
          <Button title="Cook once, plan leftovers" variant="secondary" compact onPress={batch} loading={plan.addBatch.isPending} />
        </View>
      </Card>

      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm, gap: spacing.sm, flexWrap: 'wrap' }}>
          <Text style={font.heading}>Ingredients</Text>
          <Button title="Refresh matches" variant="ghost" compact onPress={refreshMatches} loading={m.rematch.isPending} />
        </View>
        <Text style={[font.tiny, { marginBottom: spacing.sm }]}>Tap an ingredient to choose a different food or leave it out.</Text>
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
              {!header && openIng === ing.position ? (
                <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap', marginTop: spacing.xs }}>
                  <Button title="Choose food" compact onPress={() => { setOpenIng(null); router.push({ pathname: '/food/search', params: { mode: 'ingredient', recipeId: s.id, position: String(ing.position) } }); }} />
                  {ing.status !== 'Ignored' ? (
                    <Button title="Leave out" variant="secondary" compact onPress={() => { setOpenIng(null); m.updateIngredient.mutate({ id: s.id, position: ing.position, ignore: true }); }} />
                  ) : null}
                  <Button title="Cancel" variant="ghost" compact onPress={() => setOpenIng(null)} />
                </View>
              ) : null}
            </View>
          );
        })}
      </Card>

      {r.directions ? (
        <Card><Text style={[font.heading, { marginBottom: spacing.sm }]}>Directions</Text><Text style={[font.body, { lineHeight: 22 }]}>{r.directions}</Text></Card>
      ) : null}
      {r.sourceUrl ? <Button title={`Open ${r.sourceName ?? 'source'}`} variant="ghost" onPress={() => Linking.openURL(r.sourceUrl!)} /> : null}
      {confirmDelete ? (
        <Card style={{ gap: spacing.sm }}>
          <Text style={font.body}>Delete {s.name}? This can’t be undone.</Text>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Button title="Delete" variant="danger" compact loading={m.remove.isPending} onPress={async () => { await m.remove.mutateAsync(s.id); router.back(); }} />
            <Button title="Keep it" variant="ghost" compact onPress={() => setConfirmDelete(false)} />
          </View>
        </Card>
      ) : (
        <Button title="Delete recipe" variant="danger" onPress={() => setConfirmDelete(true)} />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  notice: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: 12, backgroundColor: colors.surfaceMuted },
  page: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl },
  ing: { paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, gap: 2 },
  attention: { backgroundColor: colors.attention, marginHorizontal: -spacing.sm, paddingHorizontal: spacing.sm, borderRadius: 6 },
});
