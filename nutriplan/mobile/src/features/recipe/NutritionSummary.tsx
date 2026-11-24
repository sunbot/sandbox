import { View } from 'react-native';
import type { Nutrition } from '@/api/types';
import { AppText, Badge } from '@/components/ds';
import { CircleAlert, CircleCheck, Info } from '@/components/ds/icons';
import { useTheme } from '@/theme/ThemeProvider';
import { MacroDonutChart } from './MacroDonutChart';
import { macroComposition, modeLabel, type MacroKey, type NutritionMode, type trustLines } from './nutritionView';

const legend: { key: MacroKey; name: string }[] = [
  { key: 'protein', name: 'Protein' },
  { key: 'carbs', name: 'Carbs' },
  { key: 'fat', name: 'Fat' },
];

const grams = (n: number) => (n >= 10 ? String(Math.round(n)) : (Math.round(n * 10) / 10).toString());

/**
 * The recipe's nutrition at a glance: the macro donut, exact grams and energy shares, fiber, yield, and how far the
 * numbers can be trusted. Everything shown is derived from the same `nutrition` object so the chart, legend and
 * stats can never disagree with each other.
 */
export function NutritionSummary({ nutrition, mode, makes, gramsPerServing, reliability, trust }: {
  nutrition: Nutrition;
  mode: NutritionMode;
  /** Servings the whole recipe makes. */
  makes: number;
  /** Finished weight of one serving, only when the cooked weight is known. */
  gramsPerServing?: number | null;
  reliability: { level: 'complete' | 'partial'; text: string };
  /** Coverage, match confidence and nutrient completeness, shown as separate lines. */
  trust?: ReturnType<typeof trustLines>;
}) {
  const t = useTheme();
  const comp = macroComposition(nutrition);
  const color = { protein: t.colors.protein, carbs: t.colors.carbs, fat: t.colors.fat };
  const caption = modeLabel[mode].toLowerCase();
  const stats = [
    { label: 'Calories', value: `${Math.round(nutrition.calories)} kcal` },
    { label: 'Fiber', value: `${grams(nutrition.fiber)} g` },
    { label: 'Recipe makes', value: `${makesText(makes)}${gramsPerServing ? ` · ${Math.round(gramsPerServing)} g each` : ''}` },
  ];

  return (
    <View style={{ gap: t.space.lg }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: t.space.lg }}>
        <MacroDonutChart calories={nutrition.calories} protein={nutrition.protein} carbs={nutrition.carbs} fat={nutrition.fat} caption={caption} />
        <View style={{ flex: 1, minWidth: 150, gap: t.space.sm }}>
          {legend.map(({ key, name }) => {
            const s = comp.shares.find((x) => x.key === key)!;
            return (
              <View key={key} accessible accessibilityLabel={`${name} ${Math.round(s.grams)} grams${comp.hasData ? `, ${s.percent} percent of macro calories` : ''}`}
                style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm, minHeight: 28 }}>
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color[key] }} />
                <AppText variant="body" style={{ flex: 1 }}>{name}</AppText>
                <AppText variant="bodyStrong" numeric>{grams(s.grams)} g</AppText>
                <AppText variant="secondary" tone="secondary" numeric style={{ minWidth: 40, textAlign: 'right' }}>{comp.hasData ? `${s.percent}%` : '–'}</AppText>
              </View>
            );
          })}
          <AppText variant="caption" tone="muted">% of calories from macros (protein 4, carbs 4, fat 9 kcal per g)</AppText>
        </View>
      </View>

      {comp.gapNotable ? (
        <View style={{ flexDirection: 'row', gap: t.space.sm, alignItems: 'flex-start' }}>
          <Info size={16} strokeWidth={2} color={t.colors.textMuted} style={{ marginTop: 2 }} />
          <AppText variant="caption" tone="secondary" style={{ flex: 1 }}>
            Protein, carbs and fat add up to {Math.round(comp.macroKcal)} kcal; the recipe’s calories are {Math.round(nutrition.calories)} kcal. Differences like this can come from fiber, alcohol, rounding or the source data.
          </AppText>
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space.sm, borderTopWidth: 1, borderTopColor: t.colors.border, paddingTop: t.space.md }}>
        {stats.map((s) => (
          <View key={s.label} accessible accessibilityLabel={`${s.label} ${s.value}`} style={{ flexGrow: 1, flexBasis: '30%', minWidth: 96, gap: 2 }}>
            <AppText variant="caption" tone="muted">{s.label}</AppText>
            <AppText variant="bodyStrong" numeric>{s.value}</AppText>
          </View>
        ))}
      </View>

      <View style={{ gap: t.space.xs }} accessibilityLiveRegion="polite">
        {reliability.level === 'partial' ? <Badge label="Incomplete" tone="warning" icon={CircleAlert} /> : null}
        <AppText variant="caption" tone="secondary">{reliability.text}</AppText>
      </View>

      {trust?.length ? (
        <View style={{ gap: t.space.sm }}>
          {trust.map((l) => {
            const Icon = l.weak ? CircleAlert : CircleCheck;
            return (
              <View key={l.label} accessible accessibilityLabel={`${l.label}: ${l.value}${l.detail ? `. ${l.detail}` : ''}`} style={{ flexDirection: 'row', gap: t.space.sm, alignItems: 'flex-start' }}>
                <Icon size={18} strokeWidth={2} color={l.weak ? t.colors.warning : t.colors.textMuted} style={{ marginTop: 2 }} />
                <View style={{ flex: 1, gap: 2 }}>
                  <AppText variant="caption" tone="muted">{l.label}</AppText>
                  <AppText variant="secondary">{l.value}</AppText>
                  {l.detail ? <AppText variant="caption" tone="secondary">{l.detail}</AppText> : null}
                </View>
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const makesText = (n: number) => `${Number.isInteger(n) ? n : Math.round(n * 100) / 100} ${n === 1 ? 'serving' : 'servings'}`;
