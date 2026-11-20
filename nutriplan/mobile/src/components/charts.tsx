import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import type { Nutrition } from '@/api/types';
import { colors, font, levelColor, radius, spacing } from '@/lib/theme';

/**
 * Calorie ring: the day's headline number. The number in the middle is the read-out;
 * the arc is secondary. Over target, the overflow is drawn in the "high" status color.
 */
export function CalorieRing({ eaten, target, planned = 0, size = 150 }: { eaten: number; target: number; planned?: number; size?: number }) {
  const stroke = 12;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = target > 0 ? eaten / target : 0;
  const plannedPct = target > 0 ? Math.min(1, (eaten + planned) / target) : 0;
  const remaining = Math.round(target - eaten);
  const over = remaining < 0;

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }} accessibilityLabel={`${Math.round(eaten)} of ${Math.round(target)} calories`}>
      <Svg width={size} height={size} style={[StyleSheet.absoluteFill, { transform: [{ rotate: '-90deg' }] }]}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.surfaceMuted} strokeWidth={stroke} fill="none" />
        {planned > 0 && (
          <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.calories} strokeOpacity={0.25} strokeWidth={stroke} fill="none"
            strokeDasharray={`${c * plannedPct} ${c}`} strokeLinecap="round" />
        )}
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={over ? colors.high : colors.calories} strokeWidth={stroke} fill="none"
          strokeDasharray={`${c * Math.min(pct, 1)} ${c}`} strokeLinecap="round" />
      </Svg>
      <Text style={[styles.ringNumber, font.number]}>{Math.abs(remaining)}</Text>
      <Text style={font.small}>{over ? 'kcal over' : 'kcal left'}</Text>
      <Text style={font.tiny}>{Math.round(eaten)} / {Math.round(target)}</Text>
    </View>
  );
}

/** One labelled progress bar per macro: name, grams eaten / target. */
export function MacroBars({ totals, targets }: { totals: Nutrition; targets: { protein: number; carbs: number; fat: number } }) {
  const rows = [
    { label: 'Protein', value: totals.protein, target: targets.protein, color: colors.protein },
    { label: 'Carbs', value: totals.carbs, target: targets.carbs, color: colors.carbs },
    { label: 'Fat', value: totals.fat, target: targets.fat, color: colors.fat },
  ];
  return (
    <View style={{ gap: spacing.md, flex: 1 }}>
      {rows.map((r) => (
        <ProgressBar key={r.label} label={r.label} value={r.value} target={r.target} color={r.color} unit="g" />
      ))}
    </View>
  );
}

export function ProgressBar({ label, value, target, color, unit, limit }: { label: string; value: number; target: number; color: string; unit: string; limit?: boolean }) {
  const pct = target > 0 ? value / target : 0;
  const over = pct > 1.05;
  return (
    <View>
      <View style={styles.barHeader}>
        <Text style={font.small}>{label}</Text>
        <Text style={[font.small, font.number]}>
          <Text style={{ color: colors.text, fontWeight: '600' }}>{fmt(value)}</Text> / {fmt(target)} {unit}
        </Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${Math.min(pct, 1) * 100}%`, backgroundColor: over && limit ? colors.high : color }]} />
      </View>
    </View>
  );
}

/** Day bar for the week view: eaten (solid) + still planned (light) against the day's target line. */
export function DayCalorieBar({ eaten, planned, target, maxValue }: { eaten: number; planned: number; target: number; maxValue: number }) {
  const scale = (n: number) => `${Math.min(100, (n / maxValue) * 100)}%` as const;
  const over = eaten + planned > target * 1.05;
  return (
    <View style={styles.dayTrack}>
      <View style={{ flexDirection: 'row', height: '100%', gap: 2 }}>
        {eaten > 0 && <View style={{ width: scale(eaten), backgroundColor: colors.calories, borderRadius: 4 }} />}
        {planned > 0 && <View style={{ width: scale(planned), backgroundColor: colors.calories, opacity: 0.3, borderRadius: 4 }} />}
      </View>
      <View style={[styles.targetLine, { left: scale(target), backgroundColor: over ? colors.high : colors.text }]} />
    </View>
  );
}

/** A heatmap cell: color carries the level, the number carries the value (never color alone). */
export function HeatCell({ level, percent }: { level: string; percent?: number | null }) {
  const bg = levelColor[level] ?? colors.none;
  const dark = level === 'good' || level === 'high' || level === 'veryHigh';
  return (
    <View style={[styles.cell, { backgroundColor: bg }]}>
      <Text style={[styles.cellText, { color: level === 'none' ? colors.textMuted : dark ? '#fff' : colors.text }]}>
        {percent == null ? '–' : Math.round(percent)}
      </Text>
    </View>
  );
}

export function MacroLine({ n, compact }: { n: Nutrition; compact?: boolean }) {
  return (
    <Text style={[font.small, font.number]} numberOfLines={1}>
      <Text style={{ color: colors.text, fontWeight: '600' }}>{Math.round(n.calories)} kcal</Text>
      {compact ? '' : '  ·  '}
      {compact ? ` · P${Math.round(n.protein)} C${Math.round(n.carbs)} F${Math.round(n.fat)}` : `P ${fmt(n.protein)}g  ·  C ${fmt(n.carbs)}g  ·  F ${fmt(n.fat)}g`}
    </Text>
  );
}

const fmt = (n: number) => (n >= 100 ? Math.round(n).toString() : n >= 10 ? Math.round(n).toString() : n.toFixed(1));

const styles = StyleSheet.create({
  ringNumber: { fontSize: 32, fontWeight: '700', color: colors.text },
  barHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  track: { height: 8, backgroundColor: colors.surfaceMuted, borderRadius: radius.pill, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: radius.pill },
  dayTrack: { height: 12, backgroundColor: colors.surfaceMuted, borderRadius: 4, overflow: 'visible', justifyContent: 'center' },
  targetLine: { position: 'absolute', width: 2, top: -3, bottom: -3, borderRadius: 1 },
  cell: { width: 32, height: 28, borderRadius: 4, alignItems: 'center', justifyContent: 'center', margin: 1 },
  cellText: { fontSize: 11, fontWeight: '600' },
});
