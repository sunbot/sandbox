import { Pressable, useWindowDimensions, View } from 'react-native';
import { AppText } from '@/components/ds';
import { fromIsoDate } from '@/lib/format';
import { useTheme } from '@/theme/ThemeProvider';
import { previewScale } from '@/theme/tokens';
import { chartMax, dayDetail, dayLabel, dayStatus, frac, type ChartDay } from './weekChart';

const weekday = (iso: string, narrow: boolean) => fromIsoDate(iso).toLocaleDateString(undefined, { weekday: narrow ? 'narrow' : 'short' });

/**
 * Seven columns, one per day in the week's own order. Solid = eaten, soft with an outline = still planned (never
 * eaten), a line across = that day's (adjusted) target. Tap a day to select it: its exact numbers show below the chart
 * and its card opens. Every column has a full spoken label, so nothing depends on seeing the bars.
 */
export function WeekChart({ days, selected, onSelect }: { days: ChartDay[]; selected: string | null; onSelect: (date: string) => void }) {
  const t = useTheme();
  const scale = Math.max(1, useWindowDimensions().fontScale * previewScale);
  const H = Math.round(120 * Math.min(scale, 1.3));
  // Seven columns must fit a 360 dp phone: at large text the weekday becomes one letter (the full date is in each column's label).
  const narrow = scale >= 1.25;
  const max = chartMax(days);
  const sel = days.find((d) => d.date === selected) ?? null;

  return (
    <View style={{ gap: t.space.md }}>
      <View style={{ flexDirection: 'row', gap: 2, marginHorizontal: -t.space.xs }}>
        {days.map((d) => {
          const isSel = d.date === selected;
          const eatenH = frac(d.eaten, max) * H;
          const plannedH = Math.min(H - eatenH, frac(d.planned, max) * H);
          const targetY = H - frac(d.target, max) * H;
          const over = d.overBy > 0;
          return (
            <Pressable key={d.date} onPress={() => onSelect(d.date)} accessibilityRole="button" accessibilityState={{ selected: isSel }}
              accessibilityLabel={dayLabel(d, fromIsoDate(d.date).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }))}
              accessibilityHint="Shows this day's details"
              style={({ pressed }) => ({ flex: 1, minWidth: 0, minHeight: t.sizes.touch, alignItems: 'center', gap: 4, paddingVertical: 6, borderRadius: t.radii.button,
                backgroundColor: isSel ? t.colors.primaryLight : pressed ? t.colors.surfaceMuted : 'transparent' })}>
              <View style={{ width: '62%', maxWidth: 30, height: H, justifyContent: 'flex-end' }}>
                <View style={{ position: 'absolute', inset: 0, borderRadius: 6, backgroundColor: t.colors.track }} />
                {plannedH > 0 ? <View style={{ height: plannedH, borderTopLeftRadius: 6, borderTopRightRadius: 6, borderBottomLeftRadius: eatenH > 0 ? 0 : 6, borderBottomRightRadius: eatenH > 0 ? 0 : 6,
                  backgroundColor: t.colors.primary, opacity: 0.35, borderWidth: 1, borderColor: t.colors.primary, borderStyle: 'dashed' }} /> : null}
                {eatenH > 0 ? <View style={{ height: eatenH, borderRadius: 6, borderTopLeftRadius: plannedH > 0 ? 0 : 6, borderTopRightRadius: plannedH > 0 ? 0 : 6,
                  backgroundColor: over && d.isPast ? t.colors.accent : t.colors.primary }} /> : null}
                {d.target > 0 ? <View style={{ position: 'absolute', left: -4, right: -4, top: Math.max(0, targetY - 1), height: 2, borderRadius: 1, backgroundColor: t.colors.text, opacity: 0.8 }} /> : null}
              </View>
              <AppText variant="caption" tone={isSel ? 'primary' : d.isToday ? 'default' : 'secondary'} numberOfLines={1}
                style={{ fontWeight: isSel || d.isToday ? '700' : '500', textDecorationLine: d.isToday && narrow ? 'underline' : 'none' }}>{d.isToday && !narrow ? 'Today' : weekday(d.date, narrow)}</AppText>
              <AppText variant="caption" tone="muted" numeric>{fromIsoDate(d.date).getDate()}</AppText>
            </Pressable>
          );
        })}
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: t.space.lg, rowGap: 4 }} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <Key swatch={<View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: t.colors.primary }} />} label="Eaten" />
        <Key swatch={<View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: t.colors.primary, opacity: 0.35, borderWidth: 1, borderColor: t.colors.primary, borderStyle: 'dashed' }} />} label="Still planned" />
        <Key swatch={<View style={{ width: 14, height: 2, backgroundColor: t.colors.text }} />} label="Target" />
      </View>

      {sel ? (
        <View accessibilityLiveRegion="polite" style={{ gap: 4, borderTopWidth: 1, borderTopColor: t.colors.border, paddingTop: t.space.md }}>
          <AppText variant="bodyStrong">{sel.isToday ? 'Today' : fromIsoDate(sel.date).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })}</AppText>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space.md }}>
            {dayDetail(sel).map((r) => (
              <View key={r.label} style={{ minWidth: 92, gap: 2 }}>
                <AppText variant="caption" tone="muted">{r.label}</AppText>
                <AppText variant="bodyStrong" numeric>{r.value}</AppText>
              </View>
            ))}
          </View>
          <AppText variant="secondary" tone={sel.overBy > 0 ? 'warning' : 'secondary'}>{dayStatus(sel)}</AppText>
        </View>
      ) : <AppText variant="caption" tone="muted">Tap a day for its numbers.</AppText>}
    </View>
  );
}

function Key({ swatch, label }: { swatch: React.ReactNode; label: string }) {
  const t = useTheme();
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.xs }}>{swatch}<AppText variant="caption" tone="secondary">{label}</AppText></View>;
}
