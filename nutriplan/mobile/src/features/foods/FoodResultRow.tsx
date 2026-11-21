import { Pressable, View } from 'react-native';
import { AppText, Badge } from '@/components/ds';
import { ChevronRight, CircleAlert } from '@/components/ds/icons';
import { useTheme } from '@/theme/ThemeProvider';
import { rowLabel, type FoodRow } from './foodRows';

/** One search result: brand — name, the serving it's shown for, calories and macros for that serving, and its source. */
export function FoodResultRow({ row, onPress, busy }: { row: FoodRow; onPress: () => void; busy?: boolean }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} disabled={busy} accessibilityRole="button" accessibilityLabel={rowLabel(row)} accessibilityState={{ busy: !!busy }}
      style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: t.space.md, minHeight: 64, paddingVertical: t.space.sm, borderTopWidth: 1, borderTopColor: t.colors.border }, (pressed || busy) && { backgroundColor: t.colors.surfaceMuted }]}>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <AppText variant="body" numberOfLines={2}>
          {row.brand ? <AppText variant="bodyStrong">{row.brand} — </AppText> : null}{row.title}
        </AppText>
        <AppText variant="secondary" tone="secondary" numberOfLines={1}>{row.basis}</AppText>
        {row.macros ? <AppText variant="caption" tone="secondary" numeric numberOfLines={1}>{row.macros}</AppText> : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space.xs, marginTop: 2 }}>
          <Badge label={row.source} tone={row.source === 'USDA' ? 'primary' : 'neutral'} />
          {row.note ? <Badge label={row.note} tone="warning" icon={CircleAlert} /> : null}
        </View>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <AppText variant="bodyStrong" numeric>{row.calories ?? '–'}</AppText>
        <AppText variant="caption" tone="muted">kcal</AppText>
      </View>
      <ChevronRight size={18} strokeWidth={1.8} color={t.colors.textMuted} />
    </Pressable>
  );
}
