import { useCallback, useState } from 'react';
import { ScrollView as PlainScrollView, StyleSheet, View } from 'react-native';
import { RefreshControl, ScrollView } from 'react-native-gesture-handler';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CalendarDays, ChevronLeft, ChevronRight, CloudOff } from '@/components/ds/icons';
import { useDeleteEntry, useLogFood, useLogRecipe, usePlanMutations, useUpdateEntry } from '@/api/hooks';
import type { DiaryEntry, PlanEntry, QuickLogItem } from '@/api/types';
import { AppText, EmptyState, FilterChip, IconButton, PrimaryButton, SecondaryButton, useSnackbar } from '@/components/ds';
import { EntrySheet, type EntryChange, type EntryDraft } from '@/features/today/EntrySheet';
import { MealPickerSheet, MealSection, NutrientsCard, NutrientsSheet, QuickActions, RecentFoods, SummaryCard, TodaySkeleton, displayName, type NutrientMode } from '@/features/today/sections';
import { useTodayData } from '@/features/today/useTodayData';
import { SwipeGroup } from '@/features/diary/SwipeableDiaryRow';
import { addDays, dayLabel, fromIsoDate, mealForNow, meals, type Meal, today } from '@/lib/format';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * Today: calories and macros at a glance, one-tap logging (search, scan, voice, recent foods),
 * meals with logged and planned food, and the nutrients that need attention.
 * All data and writes go through the existing API hooks; nothing about nutrition math changes here.
 */
export default function TodayScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const snackbar = useSnackbar();
  const [date, setDate] = useState(today());
  const quickMeal = mealForNow(); // default for "Log food", "Scan" and Recent
  const [recentMeal, setRecentMeal] = useState<Meal>(quickMeal); // where Recent chips add to; you can change it
  const [pickingMeal, setPickingMeal] = useState(false);
  const data = useTodayData(date, recentMeal);

  const del = useDeleteEntry();
  const update = useUpdateEntry();
  const logFood = useLogFood();
  const logRecipe = useLogRecipe();
  const plan = usePlanMutations();

  const [expanded, setExpanded] = useState<Partial<Record<Meal, boolean>>>({});
  const [editing, setEditing] = useState<DiaryEntry | null>(null);
  const [drafts, setDrafts] = useState<Record<string, EntryDraft>>({}); // kept if a sheet is dismissed by accident
  const [showNutrients, setShowNutrients] = useState(false);
  const [loggingId, setLoggingId] = useState<string | null>(null);

  const isToday = date === today();
  const go = (pathname: '/food/search' | '/scan', meal: Meal = quickMeal) => router.push({ pathname, params: { date, meal, mode: 'log' } });

  /* ── Actions ── */

  const addRecent = useCallback(async (q: QuickLogItem) => {
    try {
      const created = q.item.recipeId
        ? await logRecipe.mutateAsync({ date, meal: recentMeal, recipeId: q.item.recipeId, servings: q.item.quantity })
        : q.item.foodId && q.item.grams
          ? await logFood.mutateAsync({ date, meal: recentMeal, foodId: q.item.foodId, grams: q.item.grams })
          : null;
      if (!created) return;
      snackbar({ message: `Added ${displayName(q.item)} to ${recentMeal === 'Snack' ? 'snacks' : recentMeal.toLowerCase()}`, actionLabel: 'Undo', onAction: () => del.mutate(created.id) });
    } catch (e) {
      snackbar({ message: errorText(e, "Couldn't add that food") });
    }
  }, [date, recentMeal, logFood, logRecipe, del, snackbar]);

  const logPlanned = useCallback(async (p: PlanEntry) => {
    setLoggingId(p.id);
    try {
      // Existing endpoint: creates the diary entry from the plan and marks the plan item eaten (no duplicate).
      await plan.eaten.mutateAsync({ id: p.id });
      snackbar({ message: `Logged ${displayName(p.item)}` });
    } catch (e) {
      snackbar({ message: errorText(e, "Couldn't log that meal") });
    } finally {
      setLoggingId(null);
    }
  }, [plan.eaten, snackbar]);

  const saveEntry = useCallback(async (e: DiaryEntry, c: EntryChange) => {
    if (update.isPending) return; // no double submit
    try {
      await update.mutateAsync({ id: e.id, amount: c.amount, unit: c.unit, meal: c.meal });
      setDrafts(({ [e.id]: _, ...rest }) => rest);
      setEditing(null);
      snackbar({
        message: `Updated ${displayName(e.item)}`,
        actionLabel: 'Undo',
        // Undo puts back exactly what was there: the same amount in the same measure, and the same meal.
        onAction: () => update.mutate({ id: e.id, amount: c.amount !== undefined ? e.item.quantity : undefined, unit: c.amount !== undefined ? e.item.unit : undefined, meal: c.meal ? e.meal : undefined }),
      });
    } catch (err) {
      snackbar({ message: errorText(err, "Couldn't save changes") }); // the draft is kept, so nothing typed is lost
    }
  }, [update, snackbar]);

  const deleteEntry = useCallback((e: DiaryEntry) => {
    setDrafts(({ [e.id]: _, ...rest }) => rest);
    setEditing(null);
    data.hide(e.id); // disappears now; the server delete happens when the Undo window closes
    snackbar({
      message: `Deleted ${displayName(e.item)}`,
      actionLabel: 'Undo',
      onAction: () => data.unhide(e.id),
      onTimeout: () => del.mutate(e.id, {
        onSettled: () => data.unhide(e.id),
        onError: (err) => snackbar({ message: errorText(err, "Couldn't delete that entry") }),
      }),
    });
  }, [data, del, snackbar]);

  /* ── Render ── */

  const header = (
    <View style={{ gap: t.space.xs }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.xs }}>
        <IconButton icon={ChevronLeft} label="Previous day" onPress={() => setDate(addDays(date, -1))} />
        <View style={{ flex: 1, alignItems: 'center', gap: 2 }}>
          {isToday ? <AppText variant="overline" tone="accent" numberOfLines={1}>{greeting().toUpperCase()}</AppText> : null}
          <AppText variant="pageTitle" accessibilityRole="header" numberOfLines={1}>{dayLabel(date).split(',')[0]}</AppText>
          <AppText variant="secondary" tone="secondary" numberOfLines={2} align="center">
            {fromIsoDate(date).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
          </AppText>
        </View>
        <IconButton icon={ChevronRight} label="Next day" onPress={() => setDate(addDays(date, 1))} />
      </View>
      {!isToday ? (
        <View style={{ alignItems: 'center' }}>
          <FilterChip label="Back to today" icon={CalendarDays} onPress={() => setDate(today())} />
        </View>
      ) : null}
    </View>
  );

  const page = { paddingTop: insets.top + t.space.sm, paddingHorizontal: t.screenPadding, paddingBottom: t.space.huge * 2, gap: t.space.lg };

  if (data.day.isLoading || data.targets.isLoading) {
    return <PlainScrollView style={{ flex: 1, backgroundColor: t.colors.background }} contentContainerStyle={page}>{header}<TodaySkeleton /></PlainScrollView>;
  }

  if (data.day.error || data.targets.error || !data.view || !data.targets.data) {
    const err = data.day.error ?? data.targets.error;
    const status = (err as { status?: number } | null)?.status;
    return (
      <PlainScrollView style={{ flex: 1, backgroundColor: t.colors.background }} contentContainerStyle={page}>
        {header}
        <EmptyState icon={CloudOff}
          title={status === 401 ? 'Enter your API key' : status === 0 ? "Can't reach your server" : "Couldn't load today"}
          body={status === 401 ? 'Your server needs its key before it shares your data.' : err instanceof Error ? err.message : undefined}
          action={<View style={{ gap: t.space.sm, alignSelf: 'stretch' }}>
            <PrimaryButton label="Try again" onPress={() => { data.refetchAll(); }} />
            {status === 401 || status === 0 ? <SecondaryButton label="Open settings" onPress={() => router.push('/settings')} /> : null}
          </View>} />
      </PlainScrollView>
    );
  }

  const day = data.view;
  const targets = data.targets.data;
  // Today (or a future day) is still under way: nutrients are judged against the calories eaten so far, not the full day.
  const nutrientMode: NutrientMode = { inProgress: date >= today(), dayProgress: targets.calories > 0 ? day.totals.calories / targets.calories : 0 };
  const anythingLogged = day.meals.some((m) => m.entries.length > 0);

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background }}>
      <TopGlow />
      <SwipeGroup>{(closeOpenRow) => (
      <ScrollView
        contentContainerStyle={page}
        onScrollBeginDrag={closeOpenRow} // scrolling closes a swiped-open row
        refreshControl={<RefreshControl refreshing={data.day.isRefetching} onRefresh={() => { data.refetchAll(); }} colors={[t.colors.primary]} progressViewOffset={insets.top} />}
      >
        {header}
        <SummaryCard day={day} targets={targets} />

        <View style={{ gap: t.space.md }}>
          <QuickActions onSearch={() => go('/food/search')} onScan={() => go('/scan')}
            onVoice={() => router.push({ pathname: '/assistant', params: { listen: String(Date.now()) } })} />
          <RecentFoods items={data.quick.data ?? []} meal={recentMeal} onChangeMeal={() => setPickingMeal(true)} onPick={addRecent} />
        </View>

        <View style={{ gap: t.space.md }}>
          <AppText variant="sectionTitle" accessibilityRole="header">Meals</AppText>
          {meals.map((m) => {
            const md = day.meals.find((x) => x.meal === m);
            const entries = md?.entries ?? [];
            const planned = data.planned.filter((p) => p.meal === m);
            const isExpanded = expanded[m] ?? (entries.length + planned.length > 0);
            return (
              <MealSection key={m} meal={m} totals={md?.totals.calories ?? 0} entries={entries} planned={planned}
                expanded={isExpanded} onToggle={() => setExpanded((x) => ({ ...x, [m]: !isExpanded }))}
                onAdd={() => go('/food/search', m)} onEntry={setEditing} onDeleteEntry={deleteEntry} onLogPlanned={logPlanned} loggingId={loggingId} />
            );
          })}
        </View>

        <NutrientsCard progress={day.progress} mode={nutrientMode} anythingLogged={anythingLogged} onSeeAll={() => setShowNutrients(true)}
          onFillGaps={() => router.push({ pathname: '/gaps', params: { date } })} />
      </ScrollView>
      )}</SwipeGroup>

      <EntrySheet
        entry={editing}
        draft={editing ? drafts[editing.id] ?? null : null}
        onDraft={(d) => { if (editing) setDrafts((x) => ({ ...x, [editing.id]: d })); }}
        onClose={() => setEditing(null)} // draft is kept: reopening the same food restores it
        onSave={saveEntry}
        onDelete={deleteEntry}
        saving={update.isPending}
      />
      <NutrientsSheet visible={showNutrients} onClose={() => setShowNutrients(false)} progress={day.progress} mode={nutrientMode} />
      <MealPickerSheet visible={pickingMeal} meal={recentMeal} onClose={() => setPickingMeal(false)}
        onPick={(m) => { setRecentMeal(m); setPickingMeal(false); }} />
    </View>
  );
}

/** A soft sage light at the top of the page: depth without decoration. */
function TopGlow() {
  const t = useTheme();
  return (
    <Svg style={[StyleSheet.absoluteFill, { height: 420 }]} pointerEvents="none">
      <Defs>
        <RadialGradient id="todayGlow" cx="50%" cy="0%" rx="80%" ry="60%">
          <Stop offset="0" stopColor={t.colors.glow} stopOpacity={1} />
          <Stop offset="1" stopColor={t.colors.background} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect width="100%" height="100%" fill="url(#todayGlow)" />
    </Svg>
  );
}

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

function errorText(e: unknown, fallback: string) {
  return e instanceof Error && e.message ? e.message : fallback;
}
