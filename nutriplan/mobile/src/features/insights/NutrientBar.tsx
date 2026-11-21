import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { AppText } from '@/components/ds';
import { ChevronDown, ChevronUp, CircleAlert, CircleCheck, CircleDashed, CircleHelp, Clock, TriangleAlert, type LucideIcon } from '@/components/ds/icons';
import { useTheme } from '@/theme/ThemeProvider';
import { amountText, percentText, rowLabel, statusWord, type InsightStatus, type NutrientView } from './insights';

/**
 * One nutrient: name, exact amount / target with unit, a bar, the % of goal or limit, and a status word with an icon
 * (never color alone). Limits show a marker at the limit so "full" never reads as an achievement. Optionally
 * expandable to show details passed as children.
 */
export function NutrientBar({ view: v, expanded, onToggle, children }: { view: NutrientView; expanded?: boolean; onToggle?: () => void; children?: ReactNode }) {
  const t = useTheme();
  const meta: Record<InsightStatus, { icon: LucideIcon; color: string; tone: 'success' | 'warning' | 'error' | 'secondary' | 'muted' }> = {
    met: { icon: CircleCheck, color: t.colors.success, tone: 'success' },
    within: { icon: CircleCheck, color: t.colors.success, tone: 'success' },
    progress: { icon: CircleDashed, color: t.colors.primary, tone: 'secondary' },
    near: { icon: CircleDashed, color: t.colors.primary, tone: 'secondary' },
    behind: { icon: Clock, color: t.colors.warning, tone: 'warning' },
    below: { icon: CircleAlert, color: t.colors.warning, tone: 'warning' },
    over: { icon: TriangleAlert, color: t.colors.error, tone: 'error' },
    incomplete: { icon: CircleHelp, color: t.colors.textMuted, tone: 'secondary' },
    noData: { icon: CircleDashed, color: t.colors.textMuted, tone: 'muted' },
  };
  const m = meta[v.status];
  const Icon = m.icon;
  const ratio = v.amount == null || v.target <= 0 ? 0 : v.amount / v.target;
  // Limits: the track represents 0–125% of the limit with a marker at 100%, so an excess is visible as running past it.
  const scale = v.kind === 'Limit' ? 1.25 : 1;
  const fill = Math.max(0, Math.min(1, ratio / scale));
  const Chevron = expanded ? ChevronUp : ChevronDown;

  const body = (
    <View style={{ gap: 6, paddingVertical: t.space.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm }}>
        <Icon size={18} strokeWidth={2.2} color={m.color} />
        <AppText variant="body" style={{ flex: 1, minWidth: 0 }} numberOfLines={2}>
          {v.name}{v.kind === 'Limit' ? <AppText variant="secondary" tone="secondary"> · limit</AppText> : null}
        </AppText>
        {onToggle ? <Chevron size={18} strokeWidth={1.8} color={t.colors.textMuted} /> : null}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', columnGap: t.space.md, paddingLeft: 26 }}>
        <AppText variant="secondary" numeric>
          {v.amount == null ? <AppText variant="secondary" tone="muted">–</AppText>
            : <AppText variant="secondary" numeric style={{ fontWeight: '700' }}>{v.missing > 0 ? '≥ ' : ''}{amountText(v.amount)}</AppText>}
          <AppText variant="secondary" tone="secondary" numeric> / {amountText(v.target)} {v.unit}</AppText>
        </AppText>
        <AppText variant="caption" tone="secondary" numeric>{percentText(v)}</AppText>
      </View>
      <View style={{ paddingLeft: 26 }}>
        <View>
          <View style={{ height: 8, borderRadius: 4, backgroundColor: t.colors.track, overflow: 'hidden' }}>
            <View style={{ width: `${fill * 100}%`, height: '100%', borderRadius: 4, backgroundColor: v.status === 'noData' ? 'transparent' : m.color, opacity: v.status === 'incomplete' ? 0.6 : 1 }} />
          </View>
          {v.kind === 'Limit' ? <View pointerEvents="none" style={{ position: 'absolute', left: `${(1 / scale) * 100}%`, width: 2, top: -3, bottom: -3, borderRadius: 1, backgroundColor: t.colors.text, opacity: 0.7 }} /> : null}
        </View>
      </View>
      <AppText variant="caption" tone={m.tone} style={{ paddingLeft: 26 }}>
        {statusWord(v.status, v.kind)}{v.status === 'incomplete' ? ` · ${v.missing} ${v.missing === 1 ? 'entry' : 'entries'} without this value` : ''}
      </AppText>
    </View>
  );

  if (!onToggle) return <View accessible accessibilityLabel={rowLabel(v)}>{body}</View>;
  return (
    <View style={{ borderTopWidth: 1, borderTopColor: t.colors.border }}>
      <Pressable onPress={onToggle} accessibilityRole="button" accessibilityLabel={rowLabel(v)} accessibilityState={{ expanded: !!expanded }}
        accessibilityHint={expanded ? 'Hide details' : 'Show details'} style={({ pressed }) => [{ minHeight: t.sizes.touch }, pressed && { backgroundColor: t.colors.surfaceMuted }]}>
        {body}
      </Pressable>
      {expanded && children ? <View style={{ paddingLeft: 26, paddingBottom: t.space.md, gap: t.space.xs }}>{children}</View> : null}
    </View>
  );
}
