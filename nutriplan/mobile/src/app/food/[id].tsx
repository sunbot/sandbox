import { useState } from 'react';
import { Keyboard, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useFood, useLogFood, usePlanMutations, useRecipeMutations } from '@/api/hooks';
import { QuantityPicker, type QuantityValue } from '@/features/quantity/QuantityPicker';
import { checkQuantity, matchMeasure, parseQuantity, previewPer100, startingSelection } from '@/features/quantity/quantity';
import { MacroLine } from '@/components/charts';
import { Button, Card, Chip, ErrorView, Loading, QualityBadge } from '@/components/ui';
import { dayLabel, mealForNow, meals, type Meal, today } from '@/lib/format';
import { colors, font, spacing } from '@/lib/theme';
import { useSnackbar } from '@/components/ds';

/** Pick an amount and a meal, then log it (or put it on the plan). */
export default function FoodAmount() {
  const snackbar = useSnackbar(); // alerts don't show on web; the snackbar works everywhere
  const params = useLocalSearchParams<{ id: string; date?: string; meal?: Meal; mode?: 'log' | 'plan' | 'ingredient'; grams?: string; recipeId?: string; position?: string }>();
  const food = useFood(params.id);
  const [meal, setMeal] = useState<Meal>(params.meal ?? mealForNow());
  const [value, setValue] = useState<QuantityValue | null>(null);
  const log = useLogFood();
  const { addFood } = usePlanMutations();
  const { updateIngredient } = useRecipeMutations();
  const forIngredient = params.mode === 'ingredient' && params.recipeId && params.position;
  const date = params.date ?? today();
  const planning = params.mode === 'plan';

  if (food.isLoading) return <Loading />;
  if (food.error) return <ErrorView error={food.error} />;
  const f = food.data!;
  const base = f.baseUnit ?? 'g';
  const measures = f.measures ?? [];
  const v = value ?? startingSelection(measures, base, params.grams ? Number(params.grams) : undefined);
  const measure = matchMeasure(measures, v.unit) ?? measures[0];
  const qty = parseQuantity(v.text);
  const check = checkQuantity(qty, measure);
  const preview = previewPer100(f.per100g, check.ok ? check.base : 0);
  const busy = log.isPending || addFood.isPending || updateIngredient.isPending;

  const save = async () => {
    if (!check.ok) return snackbar({ message: check.message });
    if (busy) return; // no double submit
    Keyboard.dismiss();
    try {
      // The chosen measure is sent as-is ("12 almond"), so the entry reads the way it was logged; the server converts.
      const amount = { amount: qty!, unit: measure!.unit };
      if (forIngredient) {
        await updateIngredient.mutateAsync({ id: params.recipeId!, position: Number(params.position), foodId: f.id, ...amount });
        router.dismissTo({ pathname: '/recipe/[id]', params: { id: params.recipeId! } });
        return;
      }
      const body = { date, meal, foodId: f.id, ...amount };
      if (planning) await addFood.mutateAsync(body);
      else await log.mutateAsync(body);
      router.dismissAll();
    } catch (e) {
      snackbar({ message: e instanceof Error ? e.message : 'Could not save' });
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <View style={{ gap: 6 }}>
        <Text style={font.title}>{f.name}</Text>
        {f.brand ? <Text style={font.small}>{f.brand}</Text> : null}
        {f.source === 'UsdaBranded' ? <Text style={font.tiny}>Label data from USDA FoodData Central.</Text> : null}
        <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
          <QualityBadge quality={f.quality} source={f.source} />
          {f.qualityNote ? <Text style={[font.tiny, { flex: 1 }]}>{f.qualityNote}</Text> : null}
        </View>
      </View>

      <Card style={{ gap: spacing.md }}>
        <QuantityPicker measures={measures} value={{ text: v.text, unit: measure?.unit ?? v.unit }} baseUnit={base} onChange={setValue}
          error={qty !== null && !check.ok ? check.message : null} onSubmit={save} />
        <MacroLine n={{ ...preview, nutrients: {} }} />
      </Card>

      {!forIngredient && <View style={{ gap: spacing.sm }}>
        <Text style={font.small}>{planning ? 'Plan for' : 'Log to'} · {dayLabel(date)}</Text>
        <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
          {meals.map((m) => <Chip key={m} label={m} selected={m === meal} onPress={() => setMeal(m)} />)}
        </View>
      </View>}

      <Button title={forIngredient ? 'Use for this ingredient' : planning ? 'Add to plan' : `Add · ${Math.round(preview.calories)} kcal`} onPress={save} loading={busy} disabled={!check.ok || busy} />

      <Card>
        <Text style={[font.heading, { marginBottom: spacing.sm }]}>Per 100 {f.baseUnit ?? 'g'}</Text>
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
