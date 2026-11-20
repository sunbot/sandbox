import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useFood, useLogFood, usePlanMutations, useRecipeMutations } from '@/api/hooks';
import { AmountPicker, type AmountSelection } from '@/components/AmountPicker';
import { Button, Card, Chip, ErrorView, Loading, QualityBadge } from '@/components/ui';
import { dayLabel, mealForNow, meals, type Meal, today } from '@/lib/format';
import { colors, font, spacing } from '@/lib/theme';

/** Pick an amount and a meal, then log it (or put it on the plan). */
export default function FoodAmount() {
  const params = useLocalSearchParams<{ id: string; date?: string; meal?: Meal; mode?: 'log' | 'plan' | 'ingredient'; grams?: string; recipeId?: string; position?: string }>();
  const food = useFood(params.id);
  const [meal, setMeal] = useState<Meal>(params.meal ?? mealForNow());
  const [selection, setSelection] = useState<AmountSelection>({ grams: 0, label: '' });
  const log = useLogFood();
  const { addFood } = usePlanMutations();
  const { updateIngredient } = useRecipeMutations();
  const forIngredient = params.mode === 'ingredient' && params.recipeId && params.position;
  const date = params.date ?? today();
  const planning = params.mode === 'plan';

  if (food.isLoading) return <Loading />;
  if (food.error) return <ErrorView error={food.error} />;
  const f = food.data!;

  const save = async () => {
    if (selection.grams <= 0) return Alert.alert('Enter an amount');
    try {
      const grams = Math.round(selection.grams * 10) / 10;
      if (forIngredient) {
        await updateIngredient.mutateAsync({ id: params.recipeId!, position: Number(params.position), foodId: f.id, grams });
        router.dismissTo({ pathname: '/recipe/[id]', params: { id: params.recipeId! } });
        return;
      }
      const body = { date, meal, foodId: f.id, grams };
      if (planning) await addFood.mutateAsync(body);
      else await log.mutateAsync(body);
      router.dismissAll();
    } catch (e) {
      Alert.alert('Could not save', e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <View style={{ gap: 6 }}>
        <Text style={font.title}>{f.name}</Text>
        {f.brand ? <Text style={font.small}>{f.brand}</Text> : null}
        <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
          <QualityBadge quality={f.quality} source={f.source} />
          {f.qualityNote ? <Text style={[font.tiny, { flex: 1 }]}>{f.qualityNote}</Text> : null}
        </View>
      </View>

      <Card>
        <AmountPicker food={f} initialGrams={params.grams ? Number(params.grams) : undefined} onChange={setSelection} />
      </Card>

      {!forIngredient && <View style={{ gap: spacing.sm }}>
        <Text style={font.small}>{planning ? 'Plan for' : 'Log to'} · {dayLabel(date)}</Text>
        <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
          {meals.map((m) => <Chip key={m} label={m} selected={m === meal} onPress={() => setMeal(m)} />)}
        </View>
      </View>}

      <Button title={forIngredient ? 'Use for this ingredient' : planning ? 'Add to plan' : `Add ${Math.round(selection.grams)} g`} onPress={save} loading={log.isPending || addFood.isPending || updateIngredient.isPending} disabled={selection.grams <= 0} />

      <Card>
        <Text style={[font.heading, { marginBottom: spacing.sm }]}>Per 100 g</Text>
        {Object.entries(f.per100g.nutrients).slice(0, 40).map(([id, v]) => (
          <NutrientLine key={id} id={Number(id)} value={v} />
        ))}
      </Card>
    </ScrollView>
  );
}

const names: Record<number, [string, string]> = {
  1008: ['Calories', 'kcal'], 1003: ['Protein', 'g'], 1005: ['Carbs', 'g'], 1004: ['Fat', 'g'], 1079: ['Fiber', 'g'], 2000: ['Sugars', 'g'],
  1235: ['Added sugars', 'g'], 1258: ['Saturated fat', 'g'], 1253: ['Cholesterol', 'mg'], 1093: ['Sodium', 'mg'], 1092: ['Potassium', 'mg'],
  1087: ['Calcium', 'mg'], 1089: ['Iron', 'mg'], 1090: ['Magnesium', 'mg'], 1095: ['Zinc', 'mg'], 1106: ['Vitamin A', 'µg'], 1162: ['Vitamin C', 'mg'],
  1114: ['Vitamin D', 'µg'], 1185: ['Vitamin K', 'µg'], 1190: ['Folate', 'µg'], 1178: ['Vitamin B12', 'µg'], 1175: ['Vitamin B6', 'mg'],
};

function NutrientLine({ id, value }: { id: number; value: number }) {
  const n = names[id];
  if (!n) return null;
  return (
    <View style={styles.line}>
      <Text style={font.small}>{n[0]}</Text>
      <Text style={[font.small, font.number, { color: colors.text }]}>{value < 10 ? value.toFixed(2) : Math.round(value)} {n[1]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl },
  line: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
});
