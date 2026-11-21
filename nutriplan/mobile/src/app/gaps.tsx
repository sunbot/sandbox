import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useGaps, usePlanMutations } from '@/api/hooks';
import type { GapItem } from '@/api/types';
import { MacroLine } from '@/components/charts';
import { Button, Card, Chip, Empty, ErrorView, Loading } from '@/components/ui';
import { amount, dayLabel, mealForNow, type Meal, today } from '@/lib/format';
import { font, spacing } from '@/lib/theme';
import { useSnackbar } from '@/components/ds';

/** "What can I add to round out the day?" — combinations chosen to land on calories, macros and nutrients. */
export default function GapsScreen() {
  const snackbar = useSnackbar(); // alerts don't show on web; the snackbar works everywhere
  const { date = today() } = useLocalSearchParams<{ date?: string }>();
  const [recipesOnly, setRecipesOnly] = useState(false);
  const gaps = useGaps(date, recipesOnly);
  const plan = usePlanMutations();

  if (gaps.isLoading) return <Loading />;
  if (gaps.error) return <ErrorView error={gaps.error} onRetry={() => gaps.refetch()} />;
  const g = gaps.data!;

  const addAll = async (items: GapItem[], meal: Meal) => {
    try {
      // Foods go in one all-or-nothing request; recipes are planned one by one.
      const foods = items.filter((i) => i.foodId && !i.recipeId).map((i) => ({ foodId: i.foodId!, grams: i.amount }));
      if (foods.length) await plan.addFoods.mutateAsync({ date, meal, items: foods });
      for (const i of items.filter((x) => x.recipeId)) await plan.addRecipe.mutateAsync({ date, meal, recipeId: i.recipeId!, servings: i.amount });
      snackbar({ message: `Planned ${items.length} ${items.length === 1 ? 'item' : 'items'} for ${dayLabel(date)}. Log them on Week or Today when you eat them.` });
    } catch (e) {
      snackbar({ message: e instanceof Error ? e.message : "Couldn't add to the plan" });
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={font.title}>{dayLabel(date)}</Text>
      <Card style={{ gap: spacing.xs }}>
        <Text style={font.small}>Still to go (after what’s eaten and planned)</Text>
        <MacroLine n={g.remaining} />
        {g.gaps.length > 0 && <Text style={font.tiny}>Short on: {g.gaps.filter((x) => x.kind === 'Goal' && ![1008, 1003, 1004, 1005].includes(x.nutrientId)).map((x) => x.name).join(', ')}</Text>}
      </Card>
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <Chip label="Foods & recipes" selected={!recipesOnly} onPress={() => setRecipesOnly(false)} />
        <Chip label="Recipes only" selected={recipesOnly} onPress={() => setRecipesOnly(true)} />
      </View>

      {g.suggestions.length === 0 ? <Empty title="Nothing to fill" hint="You're on target, or there's nothing suitable to suggest yet. Log or import a few favourites." /> : null}
      {g.suggestions.map((s, i) => (
        <Card key={i} style={{ gap: spacing.sm }}>
          <Text style={font.heading}>Option {i + 1}</Text>
          {s.items.map((it, j) => (
            <View key={j} style={styles.item}>
              <Text style={[font.body, { flex: 1 }]} numberOfLines={2}>{it.name}</Text>
              <Text style={[font.small, font.number]}>{amount(it.amount, it.unit)} · {Math.round(it.nutrition.calories)} kcal</Text>
            </View>
          ))}
          <MacroLine n={s.adds} />
          <Text style={font.small}>{s.summary}</Text>
          <Button title="Add to plan" compact loading={plan.addFood.isPending || plan.addRecipe.isPending} onPress={() => addAll(s.items, mealForNow())} />
        </Card>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  item: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
});
