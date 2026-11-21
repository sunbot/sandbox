import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useRecipes } from '@/api/hooks';
import type { DiaryEntry, PlanDay, PlanEntry } from '@/api/types';
import { AppText, BottomSheet, FilterChip, PrimaryButton, SecondaryButton, TextButton } from '@/components/ds';
import { ArrowLeftRight, CalendarArrowDown, Check, Trash2, Undo2 } from '@/components/ds/icons';
import { displayName } from '@/features/today/sections';
import { amount as fmtQty, meals, shortDay, today, type Meal } from '@/lib/format';
import { useTheme } from '@/theme/ThemeProvider';

const mealLabel = (m: Meal) => (m === 'Snack' ? 'Snacks' : m);
const SCALES = [0.75, 1, 1.25, 1.5];

export type PlanAction =
  | { kind: 'eaten'; scale: number }
  | { kind: 'skip' }
  | { kind: 'reopen' }
  | { kind: 'move'; date: string; meal: Meal }
  | { kind: 'swapRecipe'; recipeId: string; name: string }
  | { kind: 'remove' };

/**
 * Everything you can do with one planned meal, in a sheet (works on web, unlike the old pop-up menu).
 * Logging is only offered on or after the planned day: planned food is never counted as eaten early.
 */
export function PlanEntrySheet({ entry, days, busy, onAction, onClose, loggedEntry, onUnlog }: {
  entry: PlanEntry | null;
  /** The diary entry that logged this planned meal, when it's been logged. */
  loggedEntry?: DiaryEntry | null;
  onUnlog?: (logged: DiaryEntry) => void;
  days: PlanDay[];
  busy?: boolean;
  onAction: (e: PlanEntry, a: PlanAction) => void;
  onClose: () => void;
}) {
  const t = useTheme();
  const [last, setLast] = useState(entry);
  if (entry && entry !== last) setLast(entry);
  const e = entry ?? last;
  const [scale, setScale] = useState(1);
  const [panel, setPanel] = useState<'main' | 'move' | 'swap'>('main');
  const [moveDate, setMoveDate] = useState<string | null>(null);
  const [moveMeal, setMoveMeal] = useState<Meal | null>(null);
  const recipes = useRecipes('');
  if (!e) return null;

  const canLog = e.status === 'Planned' && e.date <= today();
  const close = () => { setPanel('main'); setScale(1); setMoveDate(null); setMoveMeal(null); onClose(); };
  const kcal = Math.round(e.item.nutrition.calories * (canLog ? scale : 1));

  return (
    <BottomSheet visible={!!entry} onClose={close} title={displayName(e.item)}>
      <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ gap: t.space.lg, paddingBottom: t.space.md }}>
        <AppText variant="secondary" tone="secondary" numeric>
          {mealLabel(e.meal)} · {e.date === today() ? 'today' : shortDay(e.date)} · {fmtQty(e.item.quantity, e.item.unit)} · {Math.round(e.item.nutrition.calories)} kcal
          {e.status === 'Skipped' ? ' · skipped' : e.status === 'Eaten' ? ' · logged' : ' · planned'}
        </AppText>

        {panel === 'main' ? (
          <>
            {canLog ? (
              <View style={{ gap: t.space.sm }}>
                <AppText variant="label" tone="secondary">How much did you have?</AppText>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space.sm }}>
                  {SCALES.map((s) => <FilterChip key={s} label={s === 1 ? 'As planned' : `×${s}`} selected={s === scale} onPress={() => setScale(s)} />)}
                </View>
                <PrimaryButton label={`Log it · ${kcal} kcal`} icon={Check} loading={busy} fullWidth onPress={() => onAction(e, { kind: 'eaten', scale })} />
              </View>
            ) : e.status === 'Planned' ? (
              <AppText variant="secondary" tone="muted">You can log this on {shortDay(e.date)}, when you eat it.</AppText>
            ) : null}

            {e.status === 'Eaten' ? (
              <View style={{ gap: t.space.sm }}>
                <AppText variant="secondary" tone="muted">This meal is logged in your diary.</AppText>
                {loggedEntry && onUnlog ? (
                  <SecondaryButton label="Un-log (keep it planned)" icon={Undo2} tone="danger" fullWidth onPress={() => onUnlog(loggedEntry)} />
                ) : null}
              </View>
            ) : (
              <View style={{ gap: t.space.sm }}>
                {e.status === 'Skipped'
                  ? <SecondaryButton label="Plan it again" icon={Undo2} fullWidth onPress={() => onAction(e, { kind: 'reopen' })} />
                  : <SecondaryButton label="Skip this meal" fullWidth onPress={() => onAction(e, { kind: 'skip' })} />}
                <SecondaryButton label="Move to another day or meal" icon={CalendarArrowDown} fullWidth onPress={() => { setMoveDate(e.date); setMoveMeal(e.meal); setPanel('move'); }} />
                {e.item.kind === 'Recipe' ? <SecondaryButton label="Swap for another recipe" icon={ArrowLeftRight} fullWidth onPress={() => setPanel('swap')} /> : null}
                <SecondaryButton label="Remove from plan" icon={Trash2} tone="danger" fullWidth onPress={() => onAction(e, { kind: 'remove' })} />
              </View>
            )}
          </>
        ) : null}

        {panel === 'move' ? (
          <View style={{ gap: t.space.md }}>
            <AppText variant="label" tone="secondary">Day</AppText>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space.sm }}>
              {days.filter((d) => !d.isPast || d.date === e.date).map((d) => <FilterChip key={d.date} label={d.isToday ? 'Today' : shortDay(d.date)} selected={d.date === moveDate} onPress={() => setMoveDate(d.date)} />)}
            </View>
            <AppText variant="label" tone="secondary">Meal</AppText>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space.sm }}>
              {meals.map((m) => <FilterChip key={m} label={mealLabel(m)} selected={m === moveMeal} onPress={() => setMoveMeal(m)} />)}
            </View>
            <PrimaryButton label="Move" loading={busy} fullWidth disabled={!moveDate || !moveMeal || (moveDate === e.date && moveMeal === e.meal)}
              onPress={() => onAction(e, { kind: 'move', date: moveDate!, meal: moveMeal! })} />
            <TextButton label="Back" tone="secondary" onPress={() => setPanel('main')} />
          </View>
        ) : null}

        {panel === 'swap' ? (
          <View style={{ gap: t.space.xs }}>
            <AppText variant="label" tone="secondary">Swap for (same number of servings)</AppText>
            {(recipes.data ?? []).filter((r) => r.id !== e.item.recipeId).slice(0, 30).map((r) => (
              <SecondaryButton key={r.id} label={`${r.name} · ${Math.round(r.perServing.calories)} kcal`} fullWidth
                onPress={() => onAction(e, { kind: 'swapRecipe', recipeId: r.id, name: r.name })} />
            ))}
            {recipes.isLoading ? <AppText variant="secondary" tone="muted">Loading recipes…</AppText> : null}
            <TextButton label="Back" tone="secondary" onPress={() => setPanel('main')} />
          </View>
        ) : null}
      </ScrollView>
    </BottomSheet>
  );
}

/** Copy the still-planned meals of one day to another day. */
export function CopyDaySheet({ from, days, busy, onCopy, onClose }: { from: PlanDay | null; days: PlanDay[]; busy?: boolean; onCopy: (to: string) => void; onClose: () => void }) {
  const t = useTheme();
  const [to, setTo] = useState<string | null>(null);
  if (!from) return null;
  const count = from.planned.filter((p) => p.status === 'Planned').length;
  return (
    <BottomSheet visible={!!from} onClose={() => { setTo(null); onClose(); }} title={`Copy ${from.isToday ? "today's" : shortDay(from.date)} plan`}>
      <View style={{ gap: t.space.md, paddingBottom: t.space.md }}>
        <AppText variant="secondary" tone="secondary">{count} planned {count === 1 ? 'meal' : 'meals'} will be copied. Nothing is logged.</AppText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space.sm }}>
          {days.filter((d) => d.date !== from.date && !d.isPast).map((d) => <FilterChip key={d.date} label={d.isToday ? 'Today' : shortDay(d.date)} selected={d.date === to} onPress={() => setTo(d.date)} />)}
        </View>
        <PrimaryButton label={to ? `Copy to ${shortDay(to)}` : 'Choose a day'} disabled={!to} loading={busy} fullWidth onPress={() => to && onCopy(to)} />
      </View>
    </BottomSheet>
  );
}
