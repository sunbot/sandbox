import { useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { usePlanMutations, useRebalance, useWeek } from '@/api/hooks';
import type { PlanDay, PlanEntry } from '@/api/types';
import { DayCalorieBar } from '@/components/charts';
import { ItemRow } from '@/components/ItemRow';
import { Button, Card, ErrorView, Loading } from '@/components/ui';
import { addDays, fromIsoDate, mealForNow, shortDay, today } from '@/lib/format';
import { colors, font, spacing } from '@/lib/theme';

/**
 * The week at a glance: each day's target (adjusted in weekly mode), what's eaten, what's still planned.
 * Strayed? The banner offers to rescale the remaining plan; the gap filler rounds out under-planned days.
 */
export default function WeekScreen() {
  const [anchor, setAnchor] = useState(today());
  const week = useWeek(anchor);
  const rebalance = useRebalance(anchor);
  const m = usePlanMutations();
  const [open, setOpen] = useState<string | null>(today());

  if (week.isLoading) return <Loading />;
  if (week.error) return <ErrorView error={week.error} onRetry={() => week.refetch()} />;
  const w = week.data!;
  const maxValue = Math.max(...w.days.map((d) => Math.max(d.adjustedCalorieTarget, d.projected.calories))) * 1.1;

  const entryMenu = (e: PlanEntry) =>
    Alert.alert(e.item.name, `${Math.round(e.item.nutrition.calories)} kcal planned`, [
      { text: 'I ate this', onPress: () => m.eaten.mutate({ id: e.id }) },
      { text: 'Ate a bit more (×1.25)', onPress: () => m.eaten.mutate({ id: e.id, scale: 1.25 }) },
      { text: 'Skip', onPress: () => m.skip.mutate(e.id) },
      { text: 'Remove', style: 'destructive', onPress: () => m.remove.mutate(e.id) },
      { text: 'Cancel', style: 'cancel' },
    ]);

  return (
    <ScrollView contentContainerStyle={styles.page} refreshControl={<RefreshControl refreshing={week.isRefetching} onRefresh={() => { week.refetch(); rebalance.refetch(); }} />}>
      <View style={styles.header}>
        <Pressable onPress={() => setAnchor(addDays(w.weekStart, -7))} hitSlop={12}><Text style={styles.arrow}>‹</Text></Pressable>
        <View style={{ alignItems: 'center' }}>
          <Text style={font.title}>{fromIsoDate(w.weekStart).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – {fromIsoDate(w.weekEnd).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</Text>
          <Text style={font.small}>{w.budgetMode === 'Weekly' ? 'Weekly budget' : 'Daily targets'} · {Math.round(w.projectedTotal)} / {Math.round(w.weeklyCalorieTarget)} kcal projected</Text>
        </View>
        <Pressable onPress={() => setAnchor(addDays(w.weekStart, 7))} hitSlop={12}><Text style={styles.arrow}>›</Text></Pressable>
      </View>

      {rebalance.data?.map((r) => (
        <Card key={r.date} style={styles.banner}>
          <Text style={font.body}>
            {shortDay(r.date)}: plan is {Math.round(r.plannedCalories)} kcal for a {Math.round(r.adjustedTarget)} kcal target.
          </Text>
          <Text style={font.small}>Scale planned portions ×{r.suggestedScale} to land on target?</Text>
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
            <Button title={`Apply ×${r.suggestedScale}`} compact onPress={() => m.applyRebalance.mutate({ date: r.date, scale: r.suggestedScale })} />
            <Button title="Fill with suggestions" variant="secondary" compact onPress={() => router.push({ pathname: '/gaps', params: { date: r.date } })} />
          </View>
        </Card>
      ))}
      {w.unabsorbedCarryover !== 0 && (
        <Text style={[font.small, { color: colors.high }]}>
          {Math.abs(w.unabsorbedCarryover)} kcal {w.unabsorbedCarryover < 0 ? 'over' : 'under'} can’t be evened out this week without going past the daily limit.
        </Text>
      )}

      {w.days.map((d) => (
        <DayCard key={d.date} day={d} maxValue={maxValue} open={open === d.date} onToggle={() => setOpen(open === d.date ? null : d.date)} onEntry={entryMenu} />
      ))}

      <View style={styles.footer}>
        <Button title="Grocery list" icon="🛒" variant="secondary" onPress={() => router.push({ pathname: '/grocery', params: { from: maxDate(today(), w.weekStart), to: w.weekEnd } })} />
        <Button title="Nutrient heatmap" icon="▦" variant="secondary" onPress={() => router.push({ pathname: '/insights', params: { date: w.weekStart } })} />
      </View>
    </ScrollView>
  );
}

function DayCard({ day, maxValue, open, onToggle, onEntry }: { day: PlanDay; maxValue: number; open: boolean; onToggle: () => void; onEntry: (e: PlanEntry) => void }) {
  const adjusted = day.adjustedCalorieTarget !== day.baseCalorieTarget;
  const left = day.adjustedCalorieTarget - day.projected.calories;
  return (
    <Card style={day.isToday ? { borderColor: colors.primary, borderWidth: 1.5 } : undefined}>
      <Pressable onPress={onToggle}>
        <View style={styles.dayHeader}>
          <Text style={font.heading}>{day.isToday ? 'Today' : shortDay(day.date)} <Text style={font.small}>{fromIsoDate(day.date).getDate()}</Text></Text>
          <Text style={[font.small, font.number]}>
            {Math.round(day.projected.calories)} / {Math.round(day.adjustedCalorieTarget)} kcal{adjusted ? ' (adj.)' : ''}
          </Text>
        </View>
        <DayCalorieBar eaten={day.eaten.calories} planned={day.plannedRemaining.calories} target={day.adjustedCalorieTarget} maxValue={maxValue} />
        <Text style={[font.tiny, { marginTop: 4 }]}>
          {day.isUntracked ? 'Not logged' : day.isPast ? `Eaten ${Math.round(day.eaten.calories)}` : left >= 0 ? `${Math.round(left)} kcal unplanned` : `${Math.round(-left)} kcal over plan`}
          {'  ·  '}P {Math.round(day.projected.protein)} · C {Math.round(day.projected.carbs)} · F {Math.round(day.projected.fat)}
        </Text>
      </Pressable>

      {open && (
        <View style={{ marginTop: spacing.sm }}>
          {day.planned.map((e) => (
            <ItemRow key={e.id} item={e.item} muted={e.status !== 'Planned'} onPress={() => onEntry(e)}
              right={<Text style={font.tiny}>{e.status === 'Eaten' ? '✓' : e.status === 'Skipped' ? '–' : e.meal.slice(0, 1)}</Text>} />
          ))}
          {day.logged.filter((l) => !l.planEntryId).map((l) => (
            <ItemRow key={l.id} item={l.item} right={<Text style={font.tiny}>logged</Text>} />
          ))}
          {!day.isPast && (
            <View style={styles.dayActions}>
              <Button title="Add food" variant="ghost" compact onPress={() => router.push({ pathname: '/food/search', params: { date: day.date, meal: mealForNow(), mode: 'plan' } })} />
              <Button title="Add recipe" variant="ghost" compact onPress={() => router.push({ pathname: '/recipes', params: { planDate: day.date } })} />
              <Button title="Fill gaps" variant="ghost" compact onPress={() => router.push({ pathname: '/gaps', params: { date: day.date } })} />
            </View>
          )}
        </View>
      )}
    </Card>
  );
}

const maxDate = (a: string, b: string) => (a > b ? a : b);

const styles = StyleSheet.create({
  page: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  arrow: { fontSize: 32, color: colors.primary, paddingHorizontal: spacing.sm },
  banner: { backgroundColor: colors.attention, borderColor: colors.fair },
  dayHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: spacing.sm },
  dayActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  footer: { gap: spacing.sm, marginTop: spacing.sm },
});
