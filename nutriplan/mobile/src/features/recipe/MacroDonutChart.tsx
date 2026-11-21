import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { AppText } from '@/components/ds';
import { useTheme } from '@/theme/ThemeProvider';
import { previewScale } from '@/theme/tokens';
import { macroComposition, type MacroKey } from './nutritionView';

const names: Record<MacroKey, string> = { protein: 'Protein', carbs: 'Carbohydrate', fat: 'Fat' };

/** Spoken/numeric equivalent of the chart, so nothing depends on seeing the colors. */
export function macroChartLabel(n: { calories: number; protein: number; carbs: number; fat: number }, caption: string): string {
  const c = macroComposition(n);
  const head = `${Math.round(n.calories)} calories ${caption}`;
  if (!c.hasData) return `${head}. No protein, carbohydrate or fat amounts available.`;
  return `${head}. Share of macro calories: ${c.shares.map((s) => `${names[s.key]} ${Math.round(s.grams)} grams, ${s.percent} percent`).join('; ')}.`;
}

/**
 * Donut of where the energy comes from. Segment sizes are energy shares (protein 4, carbohydrate 4, fat 9 kcal/g),
 * not gram shares. The center shows the recipe's reported calories; the ring only splits macro-derived energy, so the
 * two can differ slightly (fiber, alcohol, rounding) and are never forced to agree.
 */
export function MacroDonutChart({ calories, protein, carbs, fat, caption, size: baseSize = 132 }: {
  calories: number; protein: number; carbs: number; fat: number;
  /** Words under the calories, e.g. "per serving". */
  caption: string;
  size?: number;
}) {
  const t = useTheme();
  // The centre text scales with the user's font size, so the ring grows with it (capped) instead of clipping the text.
  const fontScale = useWindowDimensions().fontScale * previewScale;
  const size = Math.round(baseSize * Math.min(1.45, Math.max(1, fontScale)));
  const stroke = Math.round(size * 0.115);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const comp = macroComposition({ calories, protein, carbs, fat });
  const colors = { protein: t.colors.protein, carbs: t.colors.carbs, fat: t.colors.fat };
  const visible = comp.shares.filter((s) => s.fraction > 0);
  const gap = visible.length > 1 ? 3 : 0; // a small gap between segments keeps neighbours distinguishable
  // Where each segment starts along the ring (computed up front so rendering stays pure).
  const starts = visible.map((_, i) => c * visible.slice(0, i).reduce((a, x) => a + x.fraction, 0));

  return (
    <View style={{ width: size, height: size }} accessible accessibilityRole="image" accessibilityLabel={macroChartLabel({ calories, protein, carbs, fat }, caption)}>
      <Svg width={size} height={size} style={{ transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={t.colors.track} strokeWidth={stroke} fill="none" />
        {visible.map((s, i) => (
          <Circle key={s.key} cx={size / 2} cy={size / 2} r={r} stroke={colors[s.key]} strokeWidth={stroke} fill="none"
            strokeDasharray={`${Math.max(0, c * s.fraction - gap)} ${c}`} strokeDashoffset={-(starts[i] + gap / 2)} />
        ))}
      </Svg>
      <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', paddingHorizontal: stroke + 4 }]} pointerEvents="none">
        <AppText variant="sectionTitle" numeric align="center" numberOfLines={1} adjustsFontSizeToFit>{Math.round(calories)}</AppText>
        <AppText variant="caption" tone="secondary" align="center">kcal</AppText>
        <AppText variant="caption" tone="muted" align="center" numberOfLines={2}>{comp.hasData ? caption : 'no macro data'}</AppText>
      </View>
    </View>
  );
}
