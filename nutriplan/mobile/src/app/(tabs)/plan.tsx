import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { useDeleteEntry, usePlanMutations, useRebalance, useUpdateEntry, useWeek } from '@/api/hooks';
import type { DiaryEntry, PlanDay, PlanEntry } from '@/api/types';
import {
  AppCard, AppText, Badge, EmptyState, FoodRow, IconButton, ListGroup, ListRow, PrimaryButton, SecondaryButton, Skeleton, TextButton, useSnackbar,
} from '@/components/ds';
import {
  CalendarClock, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, CloudOff, Copy, Grid3x3, Minus, Plus, ShoppingBasket, Sparkles,
} from '@/components/ds/icons';
import { EntrySheet, type EntryDraft } from '@/features/today/EntrySheet';
import { displayName } from '@/features/today/sections';
import { CopyDaySheet, PlanEntrySheet, type PlanAction } from '@/features/week/PlanEntrySheet';
import { WeekChart } from '@/features/week/WeekChart';
import { chartDays, weekSummary } from '@/features/week/weekChart';
import { addDays, amount as fmtQty, fromIsoDate, mealForNow, shortDay, today } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { useTheme } from '@/theme/ThemeProvider';

const fmtRange = (a: string, b: string) =>
  `${fromIsoDate(a).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${fromIsoDate(b).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
const k = (n: number) => Math.round(n).toLocaleString();

/**
 * The week: each day's target (adjusted in weekly mode), what's eaten and what's still planned. Tap a planned meal to
 * log, skip, move, swap or remove it; tap logged food to edit or delete it. Planned food never counts as eaten.
 */
export default function WeekScreen() {
  const t = useTheme();
  const snackbar = useSnackbar();
  const [anchor, setAnchor] = useState(today());
  const week = useWeek(anchor);
  const rebalance = useRebalance(anchor);
  const m = usePlanMutations();
  const update = useUpdateEntry();
  const del = useDeleteEntry();
  const [open, setOpen] = useState<string | null>(today());
  const [selected, setSelected] = useState<PlanEntry | null>(null);
  const [editing, setEditing] = useState<DiaryEntry | null>(null);
  const [drafts, setDrafts] = useState<Record<string, EntryDraft>>({});
  const [copyFrom, setCopyFrom] = useState<PlanDay | null>(null);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set()); // deletes waiting for their Undo window
  const busy = m.eaten.isPending || m.skip.isPending || m.move.isPending || m.swapRecipe.isPending || m.reopen.isPending;

  const hide = (id: string) => setHidden((s) => new Set(s).add(id));
  const unhide = (id: string) => setHidden((s) => { const n = new Set(s); n.delete(id); return n; });
  const fail = useCallback((e: unknown, fallback: string) => snackbar({ message: e instanceof Error && e.message ? e.message : fallback }), [snackbar]);

  const act = async (e: PlanEntry, a: PlanAction) => {
    const name = displayName(e.item);
    try {
      if (a.kind === 'eaten') {
        const logged = await m.eaten.mutateAsync({ id: e.id, scale: a.scale });
        haptic.success();
        // Undo deletes the diary entry, which also puts the meal back on the plan.
        snackbar({ message: `Logged ${name}`, actionLabel: 'Undo', onAction: () => del.mutate(logged.id) });
      } else if (a.kind === 'skip') {
        await m.skip.mutateAsync(e.id);
        snackbar({ message: `Skipped ${name}`, actionLabel: 'Undo', onAction: () => m.reopen.mutate(e.id) });
      } else if (a.kind === 'reopen') {
        await m.reopen.mutateAsync(e.id);
        snackbar({ message: `${name} is planned again` });
      } else if (a.kind === 'move') {
        await m.move.mutateAsync({ id: e.id, date: a.date, meal: a.meal });
        snackbar({ message: `Moved ${name} to ${shortDay(a.date)}`, actionLabel: 'Undo', onAction: () => m.move.mutate({ id: e.id, date: e.date, meal: e.meal }) });
      } else if (a.kind === 'swapRecipe') {
        await m.swapRecipe.mutateAsync({ id: e.id, recipeId: a.recipeId, servings: e.item.quantity || 1 });
        snackbar({ message: `Swapped for ${a.name}` });
      } else if (a.kind === 'remove') {
        hide(e.id);
        snackbar({ message: `Removed ${name}`, actionLabel: 'Undo', onAction: () => unhide(e.id),
          onTimeout: () => m.remove.mutate(e.id, { onSettled: () => unhide(e.id), onError: (err) => fail(err, "Couldn't remove that meal") }) });
      }
      setSelected(null);
    } catch (err) {
      fail(err, "Couldn't update the plan");
    }
  };

  const saveLogged = async (e: DiaryEntry, d: EntryDraft) => {
    const scale = e.item.quantity > 0 ? d.quantity / e.item.quantity : 1;
    const scaled = Math.abs(scale - 1) > 1e-9;
    const moved = d.meal !== e.meal;
    try {
      await update.mutateAsync({ id: e.id, scale: scaled ? scale : undefined, meal: moved ? d.meal : undefined });
      setDrafts(({ [e.id]: _, ...rest }) => rest);
      setEditing(null);
      snackbar({ message: `Updated ${displayName(e.item)}`, actionLabel: 'Undo',
        onAction: () => update.mutate({ id: e.id, scale: scaled ? 1 / scale : undefined, meal: moved ? e.meal : undefined }) });
    } catch (err) { fail(err, "Couldn't save changes"); }
  };

  const deleteLogged = (e: DiaryEntry) => {
    setEditing(null);
    hide(e.id);
    snackbar({ message: `Deleted ${displayName(e.item)}`, actionLabel: 'Undo', onAction: () => unhide(e.id),
      onTimeout: () => del.mutate(e.id, { onSettled: () => unhide(e.id), onError: (err) => fail(err, "Couldn't delete that entry") }) });
  };

  const page = { padding: t.screenPadding, gap: t.space.lg, paddingBottom: t.space.huge };

  if (week.isLoading) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: t.colors.background }} contentContainerStyle={page}>
        <Skeleton width="60%" height={28} />
        {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} width="100%" height={84} radius={20} />)}
      </ScrollView>
    );
  }
  if (week.error || !week.data) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: t.colors.background }} contentContainerStyle={page}>
        <EmptyState icon={CloudOff} title="Couldn't load your week" body={week.error instanceof Error ? week.error.message : undefined}
          action={<PrimaryButton label="Try again" onPress={() => week.refetch()} />} />
      </ScrollView>
    );
  }

  const w = week.data;
  const days = w.days.map((d) => ({ ...d, planned: d.planned.filter((p) => !hidden.has(p.id)), logged: d.logged.filter((l) => !hidden.has(l.id)) }));
  const summary = weekSummary(w);
  const chart = chartDays(w);

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background }}>
      <ScrollView contentContainerStyle={page}
        refreshControl={<RefreshControl refreshing={week.isRefetching} onRefresh={() => { week.refetch(); rebalance.refetch(); }} colors={[t.colors.primary]} />}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.xs }}>
          <IconButton icon={ChevronLeft} label="Previous week" onPress={() => setAnchor(addDays(w.weekStart, -7))} />
          <View style={{ flex: 1, alignItems: 'center' }}>
            <AppText variant="cardTitle" accessibilityRole="header" numeric>{fmtRange(w.weekStart, w.weekEnd)}</AppText>
            {anchor !== today() && !(today() >= w.weekStart && today() <= w.weekEnd)
              ? <TextButton label="Back to this week" onPress={() => setAnchor(today())} /> : null}
          </View>
          <IconButton icon={ChevronRight} label="Next week" onPress={() => setAnchor(addDays(w.weekStart, 7))} />
        </View>

        <AppCard sheen style={{ gap: t.space.md }}>
          <AppText variant="label" tone="muted">{w.budgetMode === 'Weekly' ? 'WEEKLY BUDGET' : 'DAILY TARGETS'}</AppText>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
            <AppText variant="display" numeric>{k(summary.projected)}</AppText>
            <AppText variant="secondary" tone="secondary" numeric>/ {k(summary.target)} kcal eaten + planned</AppText>
          </View>
          <Bar eaten={summary.eaten} planned={summary.planned} target={summary.target} height={8} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: t.space.sm }}>
            {[
              { label: 'Weekly target', value: `${k(summary.target)} kcal` },
              { label: 'Eaten', value: `${k(summary.eaten)} kcal` },
              { label: 'Still planned', value: `${k(summary.planned)} kcal` },
              summary.capacity >= 0
                ? { label: 'Not planned yet', value: `${k(summary.capacity)} kcal` }
                : { label: 'Over if you follow the plan', value: `${k(-summary.capacity)} kcal`, warn: true },
            ].map((x) => (
              <View key={x.label} accessible accessibilityLabel={`${x.label}: ${x.value}`} style={{ width: '50%', paddingRight: t.space.sm, gap: 2 }}>
                <AppText variant="caption" tone="muted">{x.label}</AppText>
                <AppText variant="bodyStrong" numeric tone={'warn' in x && x.warn ? 'warning' : 'default'}>{x.value}</AppText>
              </View>
            ))}
          </View>
          {w.unabsorbedCarryover !== 0 ? (
            <AppText variant="caption" tone="muted">
              {k(Math.abs(w.unabsorbedCarryover))} kcal {w.unabsorbedCarryover < 0 ? 'over' : 'under'} can’t be evened out this week without going past the daily limit.
            </AppText>
          ) : null}
        </AppCard>

        <AppCard style={{ gap: t.space.sm }}>
          <AppText variant="label" tone="muted">BY DAY</AppText>
          <WeekChart days={chart} selected={open} onSelect={(d) => { haptic.select(); setOpen(d); }} />
        </AppCard>

        {rebalance.data?.map((r) => (
          <AppCard key={r.date} style={{ gap: t.space.sm, borderColor: t.colors.primaryLight }}>
            <View style={{ flexDirection: 'row', gap: t.space.sm, alignItems: 'center' }}>
              <Sparkles size={20} strokeWidth={1.8} color={t.colors.primary} />
              <AppText variant="bodyStrong" style={{ flex: 1 }}>{shortDay(r.date)}: plan is {k(r.plannedCalories)} of {k(r.adjustedTarget)} kcal</AppText>
            </View>
            <AppText variant="secondary" tone="secondary">Scale that day’s planned portions ×{r.suggestedScale} to land on target, or fill it with suggestions.</AppText>
            <View style={{ flexDirection: 'row', gap: t.space.sm, flexWrap: 'wrap' }}>
              <PrimaryButton label={`Apply ×${r.suggestedScale}`} loading={m.applyRebalance.isPending} onPress={() => m.applyRebalance.mutate({ date: r.date, scale: r.suggestedScale }, { onError: (e) => fail(e, "Couldn't rescale") })} />
              <SecondaryButton label="Fill with suggestions" onPress={() => router.push({ pathname: '/gaps', params: { date: r.date } })} />
            </View>
          </AppCard>
        ))}

        <View style={{ gap: t.space.md }}>
          {days.map((d) => (
            <DayCard key={d.date} day={d} open={open === d.date} onToggle={() => { haptic.select(); setOpen(open === d.date ? null : d.date); }}
              onPlanned={setSelected} onLogged={setEditing} onCopy={() => setCopyFrom(d)} />
          ))}
        </View>

        <ListGroup title="This week">
          <ListRow icon={ShoppingBasket} title="Grocery list" hint="What's still planned, minus the pantry"
            onPress={() => router.push({ pathname: '/grocery', params: { from: w.weekStart > today() ? w.weekStart : today(), to: w.weekEnd } })} />
          <ListRow icon={Grid3x3} title="Weekly nutrients" hint="Every nutrient, day by day" onPress={() => router.push({ pathname: '/insights', params: { date: w.weekStart } })} />
        </ListGroup>
      </ScrollView>

      <PlanEntrySheet entry={selected} days={w.days} busy={busy} onAction={act} onClose={() => setSelected(null)}
        loggedEntry={selected ? w.days.flatMap((d) => d.logged).find((l) => l.planEntryId === selected.id) ?? null : null}
        onUnlog={(l) => { setSelected(null); deleteLogged(l); }} />
      <EntrySheet entry={editing} draft={editing ? drafts[editing.id] ?? null : null}
        onDraft={(d) => { if (editing) setDrafts((x) => ({ ...x, [editing.id]: d })); }}
        onClose={() => setEditing(null)} onSave={saveLogged} onDelete={deleteLogged} saving={update.isPending} />
      <CopyDaySheet from={copyFrom} days={w.days} busy={m.copy.isPending} onClose={() => setCopyFrom(null)}
        onCopy={async (to) => {
          try {
            const copies = await m.copy.mutateAsync({ from: copyFrom!.date, to });
            setCopyFrom(null);
            snackbar({ message: `Copied ${copies.length} ${copies.length === 1 ? 'meal' : 'meals'} to ${shortDay(to)}`, actionLabel: 'Undo', onAction: () => copies.forEach((c) => m.remove.mutate(c.id)) });
          } catch (e) { fail(e, "Couldn't copy the plan"); }
        }} />
    </View>
  );
}

/** Eaten (solid sage) + still planned (soft sage) against the target marker. Labelled in text beside it. */
function Bar({ eaten, planned, target, height = 6 }: { eaten: number; planned: number; target: number; height?: number }) {
  const t = useTheme();
  const max = Math.max(target, eaten + planned) * 1.05 || 1;
  const pct = (n: number) => `${Math.max(0, Math.min(100, (n / max) * 100))}%` as const;
  return (
    <View style={{ height, borderRadius: height, backgroundColor: t.colors.track, overflow: 'hidden' }} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <View style={{ flexDirection: 'row', height: '100%' }}>
        <View style={{ width: pct(eaten), backgroundColor: t.colors.primary }} />
        <View style={{ width: pct(planned), backgroundColor: t.colors.primary, opacity: 0.35 }} />
      </View>
      {target > 0 ? <View style={{ position: 'absolute', top: 0, bottom: 0, width: 2, left: pct(target), backgroundColor: t.colors.text, opacity: 0.7 }} /> : null}
    </View>
  );
}

function DayCard({ day, open, onToggle, onPlanned, onLogged, onCopy }: {
  day: PlanDay; open: boolean; onToggle: () => void; onPlanned: (e: PlanEntry) => void; onLogged: (e: DiaryEntry) => void; onCopy: () => void;
}) {
  const t = useTheme();
  const left = day.adjustedCalorieTarget - day.projected.calories;
  const adjusted = Math.round(day.adjustedCalorieTarget) !== Math.round(day.baseCalorieTarget);
  const status = day.isUntracked ? 'Nothing logged'
    : day.isPast ? `Ate ${k(day.eaten.calories)} kcal`
    : left >= 0 ? `${k(left)} kcal not planned yet` : `${k(-left)} kcal over target`;
  const logged = day.logged.filter((l) => !l.planEntryId);
  const planned = [...day.planned].sort((a, b) => ['Breakfast', 'Lunch', 'Dinner', 'Snack'].indexOf(a.meal) - ['Breakfast', 'Lunch', 'Dinner', 'Snack'].indexOf(b.meal));
  const hasPlanned = day.planned.some((p) => p.status === 'Planned');

  return (
    <AppCard padded={false} style={day.isToday ? { borderColor: t.colors.primary } : undefined}>
      <Pressable onPress={onToggle} accessibilityRole="button" accessibilityState={{ expanded: open }}
        accessibilityLabel={`${day.isToday ? 'Today' : shortDay(day.date)} ${fromIsoDate(day.date).getDate()}. ${k(day.projected.calories)} of ${k(day.adjustedCalorieTarget)} calories. ${status}`}
        style={({ pressed }) => [{ paddingHorizontal: t.space.lg, paddingVertical: t.space.md, gap: 2, minHeight: t.sizes.touch }, pressed && { backgroundColor: t.colors.surfaceMuted }]}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: t.space.sm }}>
          <AppText variant="cardTitle" style={{ flex: 1 }}>
            {day.isToday ? 'Today' : shortDay(day.date)} <AppText variant="secondary" tone="muted" numeric>{fromIsoDate(day.date).getDate()}</AppText>
          </AppText>
          <AppText variant="secondary" tone="secondary" numeric>{k(day.projected.calories)} / {k(day.adjustedCalorieTarget)}{adjusted ? ' adj.' : ''}</AppText>
          {open ? <ChevronUp size={18} color={t.colors.textMuted} /> : <ChevronDown size={18} color={t.colors.textMuted} />}
        </View>
        <AppText variant="caption" tone="muted" numeric>
          {status} · P {Math.round(day.projected.protein)} · C {Math.round(day.projected.carbs)} · F {Math.round(day.projected.fat)}
        </AppText>
      </Pressable>

      {open ? (
        <View style={{ paddingHorizontal: t.space.lg, paddingBottom: t.space.sm }}>
          {planned.map((e) => (
            <FoodRow key={e.id} name={displayName(e.item)} detail={`${e.meal === 'Snack' ? 'Snacks' : e.meal} · ${fmtQty(e.item.quantity, e.item.unit)}`}
              calories={e.item.nutrition.calories} onPress={() => onPlanned(e)} accessibilityHint="Log, skip, move or remove"
              badge={e.status === 'Eaten' ? <Badge label="Logged" tone="success" icon={Check} />
                : e.status === 'Skipped' ? <Badge label="Skipped" icon={Minus} />
                : <Badge label="Planned" tone="primary" icon={CalendarClock} />} />
          ))}
          {logged.map((l) => (
            <FoodRow key={l.id} name={displayName(l.item)} detail={`${l.meal === 'Snack' ? 'Snacks' : l.meal} · ${l.item.kind === 'QuickCalories' ? 'quick entry' : fmtQty(l.item.quantity, l.item.unit)}`}
              calories={l.item.nutrition.calories} onPress={() => onLogged(l)} accessibilityHint="Edit amount, change meal, or delete"
              badge={<Badge label="Logged" tone="success" icon={Check} />} />
          ))}
          {planned.length === 0 && logged.length === 0 ? <AppText variant="secondary" tone="muted" style={{ paddingVertical: t.space.sm }}>Nothing planned or logged yet.</AppText> : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: t.space.xs }}>
            {!day.isPast ? <>
              <TextButton label="Add food" icon={Plus} onPress={() => router.push({ pathname: '/food/search', params: { date: day.date, meal: mealForNow(), mode: 'plan' } })} />
              <TextButton label="Add recipe" icon={Plus} onPress={() => router.push({ pathname: '/recipes', params: { planDate: day.date } })} />
              <TextButton label="Fill gaps" icon={Sparkles} onPress={() => router.push({ pathname: '/gaps', params: { date: day.date } })} />
            </> : null}
            {hasPlanned ? <TextButton label="Copy plan" icon={Copy} onPress={onCopy} /> : null}
          </View>
        </View>
      ) : null}
    </AppCard>
  );
}
