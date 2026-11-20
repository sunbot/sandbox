import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Food, Nutrition } from '@/api/types';
import { Chip, Field } from './ui';
import { MacroLine } from './charts';
import { colors, font, spacing } from '@/lib/theme';

export type AmountSelection = { grams: number; label: string };

/**
 * Choose how much: a household portion (1 cup, 1 large, 1 slice…) × count, or exact grams/ounces.
 * Shows live nutrition for the chosen amount, computed from the food's per-100 g data.
 */
export function AmountPicker({ food, initialGrams, onChange }: { food: Food; initialGrams?: number; onChange: (s: AmountSelection) => void }) {
  const units = useMemo(
    () => [
      ...food.portions.map((p) => ({ label: p.description, grams: p.grams })),
      { label: 'g', grams: 1 },
      { label: 'oz', grams: 28.3495 },
    ],
    [food],
  );
  const firstPortion = food.portions.length > 0 ? 0 : units.length - 2;
  const [unitIndex, setUnitIndex] = useState(initialGrams ? units.length - 2 : firstPortion);
  const [count, setCount] = useState(initialGrams ? String(Math.round(initialGrams)) : unitIndex === units.length - 2 ? '100' : '1');

  const unit = units[unitIndex];
  const n = parseFloat(count.replace(',', '.'));
  const grams = Number.isFinite(n) && n > 0 ? n * unit.grams : 0;

  const nutrition: Nutrition = useMemo(() => scale(food.per100g, grams / 100), [food, grams]);

  // Report upward whenever the selection changes.
  useEffect(() => onChange({ grams, label: `${count} ${unit.label}` }), [grams, count, unit.label]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View style={{ gap: spacing.md }}>
      <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'flex-end' }}>
        <View style={{ width: 100 }}>
          <Field label="Amount" value={count} onChangeText={setCount} keyboardType="decimal-pad" selectTextOnFocus />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={font.small}>{grams > 0 ? `= ${Math.round(grams)} g` : 'Enter an amount'}</Text>
        </View>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
        {units.map((u, i) => (
          <Chip key={`${u.label}-${i}`} label={u.label === 'g' || u.label === 'oz' ? u.label : `${u.label} (${Math.round(u.grams)} g)`} selected={i === unitIndex}
            onPress={() => { setUnitIndex(i); if (u.label === 'g' && unit.label !== 'g') setCount('100'); else if (unit.label === 'g' && u.label !== 'g') setCount('1'); }} />
        ))}
      </ScrollView>
      <View style={styles.preview}>
        <MacroLine n={nutrition} />
        <Text style={font.tiny}>Fiber {nutrition.fiber.toFixed(1)} g · from {food.source.replace('Usda', 'USDA ')} data per 100 g</Text>
      </View>
    </View>
  );
}

export function scale(n: Nutrition, factor: number): Nutrition {
  const nutrients: Record<string, number> = {};
  for (const [k, v] of Object.entries(n.nutrients)) nutrients[k] = v * factor;
  return { calories: n.calories * factor, protein: n.protein * factor, carbs: n.carbs * factor, fat: n.fat * factor, fiber: n.fiber * factor, nutrients };
}

const styles = StyleSheet.create({
  preview: { backgroundColor: colors.surfaceMuted, borderRadius: 10, padding: spacing.md, gap: 4 },
});
