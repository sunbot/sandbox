import { Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import type { Heatmap, HeatmapCell } from '@/api/types';
import { AppText } from '@/components/ds';
import { fromIsoDate } from '@/lib/format';
import { useTheme } from '@/theme/ThemeProvider';
import { previewScale } from '@/theme/tokens';
import { cellText } from './insights';

/** Short names for the narrow column (the full name is in each cell's accessibility label). */
const shortName = (n: string) => ({ Carbohydrates: 'Carbs', 'Saturated fat': 'Sat. fat', 'Added sugars': 'Added sugar' } as Record<string, string>)[n] ?? n;

const levelWord: Record<string, string> = { good: 'on track', fair: 'part way', low: 'under half', high: 'over', veryHigh: 'well over', none: 'not logged' };

/**
 * Nutrients by day, each cell the % of goal or limit (a number, never colour alone). Nutrient names stay put while the
 * days scroll sideways. Today and the selected day are marked; "avg" covers finished logged days only.
 */
export function HeatmapView({ heat, today, selected, onSelectDay }: { heat: Heatmap; today: string; selected: string | null; onSelectDay: (d: string) => void }) {
  const t = useTheme();
  const fontScale = Math.max(1, useWindowDimensions().fontScale * previewScale);
  const rowH = Math.round(44 * Math.min(fontScale, 1.6));
  const cellW = Math.round(46 * Math.min(fontScale, 1.25));
  const nameW = Math.round(104 * Math.min(fontScale, 1.2));
  const days = heat.rows[0]?.days ?? [];
  const colors: Record<string, [string, string]> = {
    good: [t.colors.successLight, t.colors.successText], fair: [t.colors.surfaceMuted, t.colors.text],
    low: [t.colors.warningLight, t.colors.warningText], high: [t.colors.errorLight, t.colors.errorText],
    veryHigh: [t.colors.errorLight, t.colors.errorText], none: ['transparent', t.colors.textMuted],
  };
  const dayName = (d: string) => fromIsoDate(d).toLocaleDateString(undefined, { weekday: 'short' });
  const dayNum = (d: string) => fromIsoDate(d).getDate();

  const header = (d: string) => {
    const isSel = d === selected, isToday = d === today;
    return (
      <Pressable key={d} onPress={() => onSelectDay(d)} accessibilityRole="button" accessibilityState={{ selected: isSel }}
        accessibilityLabel={`${isToday ? 'Today, ' : ''}${fromIsoDate(d).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}. Show this day`}
        style={{ width: cellW, height: rowH + 6, alignItems: 'center', justifyContent: 'center', borderRadius: t.radii.button, backgroundColor: isSel ? t.colors.primaryLight : 'transparent' }}>
        <AppText variant="caption" tone={isSel ? 'primary' : 'secondary'} style={{ fontWeight: isSel ? '700' : '500' }}>{isToday ? 'Today' : dayName(d)}</AppText>
        <AppText variant="caption" tone={isSel ? 'primary' : 'muted'} numeric>{dayNum(d)}</AppText>
      </Pressable>
    );
  };

  const cell = (name: string, kind: string, c: HeatmapCell) => {
    const [bg, fg] = colors[c.level] ?? colors.none;
    const isSel = c.date === selected;
    const label = c.percent == null ? `${name}, ${dayName(c.date)}: not logged`
      : `${name}, ${dayName(c.date)}: ${(c.missingFrom ?? 0) > 0 ? 'at least ' : ''}${Math.round(c.percent)} percent of ${kind === 'Limit' ? 'limit' : 'goal'}, ${levelWord[c.level] ?? c.level}${c.date === today ? ', day still under way' : ''}`;
    return (
      <View key={c.date} accessible accessibilityLabel={label}
        style={{ width: cellW, height: rowH, padding: 2 }}>
        <View style={{ flex: 1, borderRadius: 8, backgroundColor: bg, alignItems: 'center', justifyContent: 'center',
          borderWidth: isSel ? 2 : c.level === 'none' ? 1 : 0, borderColor: isSel ? t.colors.primary : t.colors.border, borderStyle: c.date === today && !isSel ? 'dashed' : 'solid' }}>
          <AppText variant="caption" numeric style={{ color: fg, fontWeight: '700' }}>{cellText(c)}</AppText>
        </View>
      </View>
    );
  };

  return (
    <View style={{ flexDirection: 'row' }}>
      <View style={{ width: nameW }}>
        <View style={{ height: rowH + 6, justifyContent: 'center' }}><AppText variant="caption" tone="muted">% of target</AppText></View>
        {heat.rows.map((r) => (
          <View key={r.nutrientId} style={{ height: rowH, justifyContent: 'center', paddingRight: t.space.xs }}>
            <AppText variant="secondary" numberOfLines={2} accessibilityLabel={r.name}>{shortName(r.name)}{r.kind === 'Limit' ? <AppText variant="caption" tone="secondary"> limit</AppText> : null}</AppText>
          </View>
        ))}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ paddingRight: t.space.sm }}>
        <View>
          <View style={{ flexDirection: 'row' }}>
            {days.map((d) => header(d.date))}
            <View style={{ width: cellW, height: rowH + 6, alignItems: 'center', justifyContent: 'center' }} accessible accessibilityLabel="Average of finished days">
              <AppText variant="caption" tone="secondary">avg</AppText>
            </View>
          </View>
          {heat.rows.map((r) => (
            <View key={r.nutrientId} style={{ flexDirection: 'row' }}>
              {r.days.map((c) => cell(r.name, r.kind, c))}
              <View style={{ width: cellW, height: rowH, alignItems: 'center', justifyContent: 'center' }} accessible
                accessibilityLabel={(r.completedDays ?? 0) === 0 ? `${r.name}: no finished days to average` : `${r.name}: average ${(r.incompleteDays ?? 0) > 0 ? 'at least ' : ''}${Math.round(r.weeklyAveragePercent)} percent over ${r.completedDays} finished days`}>
                <AppText variant="caption" tone="secondary" numeric style={{ fontWeight: '600' }}>
                  {(r.completedDays ?? 0) === 0 ? '–' : `${(r.incompleteDays ?? 0) > 0 ? '≥' : ''}${Math.round(r.weeklyAveragePercent)}`}
                </AppText>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

/** What the colours and marks mean, in words. */
export function HeatmapLegend() {
  const t = useTheme();
  const items: [string, string, string][] = [
    [t.colors.successLight, t.colors.successText, '90% of goal or more, or within limit'],
    [t.colors.surfaceMuted, t.colors.text, '50–89% of goal'],
    [t.colors.warningLight, t.colors.warningText, 'Under 50% of goal'],
    [t.colors.errorLight, t.colors.errorText, 'Over limit, or calories, carbs or fat over 110%'],
  ];
  return (
    <View style={{ gap: 6 }}>
      {items.map(([bg, fg, label]) => (
        <View key={label} style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm }}>
          <View style={{ width: 28, height: 20, borderRadius: 5, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}><AppText variant="caption" style={{ color: fg, fontWeight: '700' }}>%</AppText></View>
          <AppText variant="caption" tone="secondary" style={{ flex: 1 }}>{label}</AppText>
        </View>
      ))}
      <AppText variant="caption" tone="muted">“–” not logged · “≥” some entries had no value, so the real amount may be higher · dashed outline: today, still under way · “avg” covers finished days only.</AppText>
    </View>
  );
}
