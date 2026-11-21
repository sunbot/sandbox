import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useGaps, usePlanMutations } from '@/api/hooks';
import type { GapItem, Nutrition } from '@/api/types';
import { AppCard, AppText, EmptyState, FilterChip, PrimaryButton, Skeleton, useSnackbar } from '@/components/ds';
import { CalendarClock, Check, CloudOff, Sparkles } from '@/components/ds/icons';
import { friendlyFoodName } from '@/lib/foodName';
import { amount, dayLabel, mealForNow, meals, type Meal, today } from '@/lib/format';
import { useTheme } from '@/theme/ThemeProvider';

const MACROS = [1008, 1003, 1004, 1005];
const mealLabel = (m: Meal) => (m === 'Snack' ? 'Snacks' : m);
const r0 = (n: number) => Math.round(n);

/**
 * "What can I add to round out the day?" — combinations chosen to land on calories, macros and nutrients.
 * Adding puts them on the plan (never in the diary) for the meal you pick.
 */
export default function GapsScreen() {
  const t = useTheme();
  const snackbar = useSnackbar(); // alerts don't show on web; the snackbar works everywhere
  const { date = today() } = useLocalSearchParams<{ date?: string }>();
  const [recipesOnly, setRecipesOnly] = useState(false);
  const [meal, setMeal] = useState<Meal>(mealForNow());
  const [added, setAdded] = useState<Set<number>>(new Set());
  const [adding, setAdding] = useState<number | null>(null);
  const gaps = useGaps(date, recipesOnly);
  const plan = usePlanMutations();
  const page = { padding: t.screenPadding, gap: t.space.lg, paddingBottom: t.space.huge };

  if (gaps.isLoading) return <ScrollView style={{ flex: 1, backgroundColor: t.colors.background }} contentContainerStyle={page}>{[0, 1, 2].map((i) => <Skeleton key={i} width="100%" height={140} radius={20} />)}</ScrollView>;
  if (gaps.error || !gaps.data) {
    return <ScrollView style={{ flex: 1, backgroundColor: t.colors.background }} contentContainerStyle={page}>
      <EmptyState icon={CloudOff} title="Couldn't load suggestions" body={gaps.error instanceof Error ? gaps.error.message : undefined} action={<PrimaryButton label="Try again" onPress={() => gaps.refetch()} />} />
    </ScrollView>;
  }
  const g = gaps.data;
  const shortOn = g.gaps.filter((x) => x.kind === 'Goal' && !MACROS.includes(x.nutrientId)).map((x) => x.name);

  const addAll = async (i: number, items: GapItem[]) => {
    setAdding(i);
    try {
      // Foods go in one all-or-nothing request; recipes are planned one by one.
      const foods = items.filter((x) => x.foodId && !x.recipeId).map((x) => ({ foodId: x.foodId!, grams: x.amount }));
      if (foods.length) await plan.addFoods.mutateAsync({ date, meal, items: foods });
      for (const x of items.filter((y) => y.recipeId)) await plan.addRecipe.mutateAsync({ date, meal, recipeId: x.recipeId!, servings: x.amount });
      setAdded((s) => new Set(s).add(i));
      snackbar({ message: `Planned for ${dayLabel(date).split(',')[0].toLowerCase()} · ${mealLabel(meal).toLowerCase()}. Log it when you eat it.` });
    } catch (e) {
      snackbar({ message: e instanceof Error ? e.message : "Couldn't add to the plan" });
    } finally { setAdding(null); }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.colors.background }} contentContainerStyle={page}>
      <AppCard sheen style={{ gap: t.space.sm }}>
        <AppText variant="label" tone="muted">STILL TO GO · {dayLabel(date).toUpperCase()}</AppText>
        <Remaining n={g.remaining} />
        <AppText variant="caption" tone="muted">After what’s eaten and planned.{shortOn.length ? ` Short on ${shortOn.slice(0, 4).join(', ')}${shortOn.length > 4 ? ` and ${shortOn.length - 4} more` : ''}.` : ''}</AppText>
      </AppCard>

      <View style={{ gap: t.space.xs }}>
        <View style={{ flexDirection: 'row', gap: t.space.sm, flexWrap: 'wrap' }}>
          <FilterChip label="Foods & recipes" selected={!recipesOnly} onPress={() => setRecipesOnly(false)} />
          <FilterChip label="Recipes only" selected={recipesOnly} onPress={() => setRecipesOnly(true)} />
        </View>
        <AppText variant="label" tone="secondary">Add to</AppText>
        <View style={{ flexDirection: 'row', gap: t.space.sm, flexWrap: 'wrap' }}>
          {meals.map((m) => <FilterChip key={m} label={mealLabel(m)} selected={m === meal} onPress={() => setMeal(m)} />)}
        </View>
      </View>

      {g.suggestions.length === 0 ? <EmptyState icon={Sparkles} title="Nothing to fill" body="You're on target, or there's nothing suitable yet. Log or import a few favourites." /> : null}
      {g.suggestions.map((s, i) => (
        <AppCard key={i} padded={false}>
          <View style={{ padding: t.space.lg, paddingBottom: t.space.sm, gap: 2 }}>
            <AppText variant="cardTitle">Option {i + 1} · +{r0(s.adds.calories)} kcal</AppText>
            <AppText variant="secondary" tone="secondary">{s.summary}</AppText>
          </View>
          {s.items.map((it, j) => (
            <View key={j} style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.md, minHeight: 52, paddingHorizontal: t.space.lg, paddingVertical: t.space.xs, borderTopWidth: 1, borderTopColor: t.colors.border }}>
              <View style={{ flex: 1, gap: 2 }}>
                <AppText variant="body" numberOfLines={2}>{it.kind === 'Food' ? friendlyFoodName(it.name) : it.name}</AppText>
                <AppText variant="caption" tone="muted">{amount(it.amount, it.unit)}</AppText>
              </View>
              <AppText variant="bodyStrong" numeric>{r0(it.nutrition.calories)}</AppText>
            </View>
          ))}
          <View style={{ padding: t.space.lg, paddingTop: t.space.sm }}>
            <PrimaryButton label={added.has(i) ? 'Planned' : `Plan for ${mealLabel(meal).toLowerCase()}`} icon={added.has(i) ? Check : CalendarClock}
              disabled={added.has(i)} loading={adding === i} onPress={() => addAll(i, s.items)} fullWidth />
          </View>
        </AppCard>
      ))}
    </ScrollView>
  );
}

function Remaining({ n }: { n: Nutrition }) {
  const t = useTheme();
  const parts = [
    { label: 'kcal', value: n.calories, color: t.colors.primary },
    { label: 'protein', value: n.protein, color: t.colors.protein, unit: 'g' },
    { label: 'carbs', value: n.carbs, color: t.colors.carbs, unit: 'g' },
    { label: 'fat', value: n.fat, color: t.colors.fat, unit: 'g' },
  ];
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: t.space.lg, rowGap: t.space.xs }}>
      {parts.map((p) => (
        <View key={p.label} style={{ gap: 2 }}>
          <AppText variant="sectionTitle" numeric>{r0(Math.max(0, p.value))}{p.unit ? <AppText variant="secondary" tone="muted"> {p.unit}</AppText> : null}</AppText>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: p.color }} />
            <AppText variant="caption" tone="secondary">{p.label}</AppText>
          </View>
        </View>
      ))}
    </View>
  );
}
