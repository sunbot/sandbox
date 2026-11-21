import { View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { AppText } from '@/components/ds';
import { CircleCheck, CircleDashed, CircleHelp, TriangleAlert, type LucideIcon } from '@/components/ds/icons';
import { useTheme } from '@/theme/ThemeProvider';
import type { Summary } from './insights';

/**
 * At a glance: how many nutrient goals are met, still open, over a limit, or can't be judged because some entries lack
 * the value. The ring shows goals met; every number is also written out. `openWord` is "In progress" for today and
 * "Below goal" for a finished day or a weekly average, so an unfinished day never reads as a shortfall.
 */
export function NutrientSummary({ summary: s, openWord }: { summary: Summary; openWord: string }) {
  const t = useTheme();
  const size = 76, stroke = 8, r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const ratio = s.goals > 0 ? s.met / s.goals : 0;
  const rows: { icon: LucideIcon; color: string; label: string; value: string }[] = [
    { icon: CircleCheck, color: t.colors.success, label: 'Goals met', value: `${s.met} of ${s.goals}` },
    { icon: CircleDashed, color: t.colors.primary, label: openWord, value: String(s.open) },
    { icon: TriangleAlert, color: t.colors.error, label: 'Over a limit', value: `${s.over} of ${s.limits}` },
  ];
  if (s.incomplete > 0) rows.push({ icon: CircleHelp, color: t.colors.textMuted, label: 'Some data missing', value: String(s.incomplete) });

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: t.space.lg }}>
      <View style={{ width: size, height: size }} accessible accessibilityLabel={`${s.met} of ${s.goals} nutrient goals met`}>
        <Svg width={size} height={size} style={{ transform: [{ rotate: '-90deg' }] }}>
          <Circle cx={size / 2} cy={size / 2} r={r} stroke={t.colors.track} strokeWidth={stroke} fill="none" />
          {ratio > 0 ? <Circle cx={size / 2} cy={size / 2} r={r} stroke={t.colors.success} strokeWidth={stroke} fill="none" strokeLinecap="round"
            strokeDasharray={`${c} ${c}`} strokeDashoffset={c * (1 - ratio)} /> : null}
        </Svg>
        <View style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' }} pointerEvents="none">
          <AppText variant="bodyStrong" numeric>{s.met}/{s.goals}</AppText>
        </View>
      </View>
      <View style={{ flex: 1, minWidth: 180, gap: 4 }}>
        {rows.map(({ icon: Icon, color, label, value }) => (
          <View key={label} accessible accessibilityLabel={`${label}: ${value}`} style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm, minHeight: 26 }}>
            <Icon size={16} strokeWidth={2.2} color={color} />
            <AppText variant="secondary" tone="secondary" style={{ flex: 1 }}>{label}</AppText>
            <AppText variant="secondary" numeric style={{ fontWeight: '700' }}>{value}</AppText>
          </View>
        ))}
      </View>
    </View>
  );
}
