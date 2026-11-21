import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Item } from '@/api/types';
import { amount } from '@/lib/format';
import { colors, font, spacing } from '@/lib/theme';
import { ChefHat } from '@/components/ds/icons';

/** One food/recipe line: name, amount, calories and macros. Used by the diary, plan and suggestions. */
export function ItemRow({ item, onPress, right, muted }: { item: Item; onPress?: () => void; right?: React.ReactNode; muted?: boolean }) {
  const n = item.nutrition;
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {item.kind === 'Recipe' ? <ChefHat size={16} strokeWidth={1.8} color={colors.textMuted} accessibilityLabel="Recipe" /> : null}
          <Text style={[font.body, { flexShrink: 1 }, muted && { color: colors.textMuted }]} numberOfLines={1}>{item.name}</Text>
        </View>
        <Text style={font.small} numberOfLines={1}>
          {amount(item.quantity, item.unit)}{item.grams && item.unit !== 'g' ? ` · ${Math.round(item.grams)} g` : ''}  ·  P {Math.round(n.protein)} · C {Math.round(n.carbs)} · F {Math.round(n.fat)}
        </Text>
      </View>
      <Text style={[styles.kcal, font.number, muted && { color: colors.textMuted }]}>{Math.round(n.calories)}</Text>
      {right}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm, gap: spacing.md },
  kcal: { fontSize: 15, fontWeight: '600', color: colors.text, minWidth: 44, textAlign: 'right' },
});
