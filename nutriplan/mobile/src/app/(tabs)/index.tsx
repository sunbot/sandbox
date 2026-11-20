import { useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useDay, useDeleteEntry, useLogFood, useLogRecipe, useQuickLog, useTargets, useUpdateEntry } from '@/api/hooks';
import type { DiaryEntry, QuickLogItem } from '@/api/types';
import { CalorieRing, MacroBars, ProgressBar } from '@/components/charts';
import { ItemRow } from '@/components/ItemRow';
import { Button, Card, Chip, ErrorView, Loading } from '@/components/ui';
import { addDays, dayLabel, mealForNow, type Meal, today } from '@/lib/format';
import { colors, font, spacing } from '@/lib/theme';

/** Today: the headline numbers, each meal, and the fastest ways to add food. */
export default function TodayScreen() {
  const [date, setDate] = useState(today());
  const day = useDay(date);
  const targets = useTargets();
  const quick = useQuickLog(mealForNow());
  const del = useDeleteEntry();
  const update = useUpdateEntry();
  const logFood = useLogFood();
  const logRecipe = useLogRecipe();

  if (day.isLoading || targets.isLoading) return <Loading />;
  if (day.error || targets.error) return <ErrorView error={day.error ?? targets.error} onRetry={() => { day.refetch(); targets.refetch(); }} />;
  const d = day.data!;
  const t = targets.data!;
  const focus = d.progress.filter((p) => t.nutrients.some((n) => n.isFocus && n.nutrientId === p.nutrientId)).slice(0, 6);

  const add = (meal: Meal, path: '/food/search' | '/scan' | '/quick-add' = '/food/search') =>
    router.push({ pathname: path, params: { date, meal, mode: 'log' } });

  const entryMenu = (e: DiaryEntry) =>
    Alert.alert(e.item.name, undefined, [
      { text: 'Half', onPress: () => update.mutate({ id: e.id, scale: 0.5 }) },
      { text: 'Double', onPress: () => update.mutate({ id: e.id, scale: 2 }) },
      { text: 'Delete', style: 'destructive', onPress: () => del.mutate(e.id) },
      { text: 'Cancel', style: 'cancel' },
    ]);

  const relog = (q: QuickLogItem) => {
    const meal = mealForNow();
    if (q.item.recipeId) logRecipe.mutate({ date, meal, recipeId: q.item.recipeId, servings: q.item.quantity });
    else if (q.item.foodId && q.item.grams) logFood.mutate({ date, meal, foodId: q.item.foodId, grams: q.item.grams });
  };

  return (
    <ScrollView contentContainerStyle={styles.page} refreshControl={<RefreshControl refreshing={day.isRefetching} onRefresh={() => { day.refetch(); }} />}>
      <View style={styles.dateRow}>
        <Pressable onPress={() => setDate(addDays(date, -1))} hitSlop={12}><Text style={styles.arrow}>‹</Text></Pressable>
        <Pressable onPress={() => setDate(today())}><Text style={font.title}>{dayLabel(date)}</Text></Pressable>
        <Pressable onPress={() => setDate(addDays(date, 1))} hitSlop={12}><Text style={styles.arrow}>›</Text></Pressable>
      </View>

      <Card style={styles.summary}>
        <CalorieRing eaten={d.totals.calories} target={t.calories} />
        <MacroBars totals={d.totals} targets={{ protein: t.proteinGrams, carbs: t.carbGrams, fat: t.fatGrams }} />
      </Card>

      <View style={styles.actions}>
        <Button title="Search" icon="🔍" onPress={() => add(mealForNow())} compact />
        <Button title="Scan" icon="▥" variant="secondary" onPress={() => add(mealForNow(), '/scan')} compact />
        <Button title="Ask / speak" icon="💬" variant="secondary" onPress={() => router.push('/assistant')} compact />
      </View>

      {quick.data && quick.data.length > 0 && (
        <View>
          <Text style={[font.small, { marginBottom: spacing.sm }]}>Quick add · tap to log to {mealForNow().toLowerCase()}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
            {quick.data.map((q, i) => (
              <Chip key={i} label={`${q.item.name.split(',')[0]} · ${Math.round(q.item.nutrition.calories)}`} onPress={() => relog(q)} />
            ))}
          </ScrollView>
        </View>
      )}

      {d.meals.map((m) => (
        <Card key={m.meal}>
          <View style={styles.mealHeader}>
            <Text style={font.heading}>{m.meal}</Text>
            <Text style={[font.small, font.number]}>{Math.round(m.totals.calories)} kcal</Text>
          </View>
          {m.entries.map((e) => (
            <ItemRow key={e.id} item={e.item} onPress={() => entryMenu(e)} />
          ))}
          <View style={styles.mealButtons}>
            <Button title="Add food" variant="ghost" compact onPress={() => add(m.meal)} />
            <Button title="Quick kcal" variant="ghost" compact onPress={() => add(m.meal, '/quick-add')} />
          </View>
        </Card>
      ))}

      <Card>
        <View style={styles.mealHeader}>
          <Text style={font.heading}>Nutrients</Text>
          <Button title="Fill gaps" variant="ghost" compact onPress={() => router.push({ pathname: '/gaps', params: { date } })} />
        </View>
        <View style={{ gap: spacing.md }}>
          <ProgressBar label="Fiber" value={d.totals.fiber} target={d.progress.find((p) => p.nutrientId === 1079)?.target ?? 28} color={colors.calories} unit="g" />
          {focus.filter((p) => p.nutrientId !== 1079 && p.target).map((p) => (
            <ProgressBar key={p.nutrientId} label={p.name} value={p.amount} target={p.target!} unit={p.unit} color={colors.calories} limit={p.kind === 'Limit'} />
          ))}
        </View>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl },
  dateRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  arrow: { fontSize: 32, color: colors.primary, paddingHorizontal: spacing.sm },
  summary: { flexDirection: 'row', gap: spacing.lg, alignItems: 'center' },
  actions: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  mealHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xs },
  mealButtons: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
});
