import { useEffect, useRef, useState } from 'react';
import { ScrollView, View, type ScrollViewInstance } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useGaps, useLogFoods, useLogRecipe, usePlanMutations } from '@/api/hooks';
import type { GapItem, GapMode, GapSuggestion, GapSwap, GapTip, GapTipItem } from '@/api/types';
import { AppCard, AppText, Badge, EmptyState, FilterChip, PrimaryButton, SecondaryButton, Skeleton, TextButton, useSnackbar } from '@/components/ds';
import { ArrowLeftRight, CalendarClock, CalendarPlus, Check, CircleCheck, CloudOff, Info, RefreshCw, Sparkles } from '@/components/ds/icons';
import { calorieHeadline, effectLine, emptyCopy, fmtAmount, MODE_LABEL, macroText, modeChips, originBadges, planPayload, rotationState, shortOn, skipShown, skippedFor, suggestionId, withSkipped, type SkippedByMode } from '@/features/gaps/gapView';
import { friendlyFoodName } from '@/lib/foodName';
import { addDays, dayLabel, mealForNow, meals, type Meal, today } from '@/lib/format';
import { useTheme } from '@/theme/ThemeProvider';

const mealLabel = (m: Meal) => (m === 'Snack' ? 'Snacks' : m);
const nice = (it: { kind: string; name: string }) => (it.kind === 'Food' ? friendlyFoodName(it.name) : it.name);

/**
 * "What can I add to round out the day?" Realistic meals and snacks when there's room; on a day that's at or over
 * target nothing is added: lighter swaps for what's planned and ideas for another day instead.
 * Adding puts items on the plan (or logs them) for the meal you pick.
 *
 * "Show different ideas" asks the same engine for the next qualifying ideas, skipping every one shown so far in this visit
 * (the server's stable ids). Filters and the meal stay as chosen; planning something recalculates what's left. Leaving the
 * screen ends the session, so coming back starts from the best ideas again.
 */
export default function GapsScreen() {
  const t = useTheme();
  const snackbar = useSnackbar(); // alerts don't show on web; the snackbar works everywhere
  const { date = today() } = useLocalSearchParams<{ date?: string }>();
  const [mode, setMode] = useState<GapMode>('BestMatch');
  const [showDataNotes, setShowDataNotes] = useState(false);
  const [meal, setMeal] = useState<Meal>(mealForNow());
  const [done, setDone] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  // Steps already saved, so a retry after a partial failure doesn't add them twice.
  const saved = useRef(new Set<string>());
  // Ideas shown and passed over in this visit, per filter: rotating in Best match doesn't use up Saved recipes.
  const [skippedBy, setSkippedBy] = useState<SkippedByMode>({});
  const skipped = skippedFor(skippedBy, mode);
  const setSkipped = (f: (s: string[]) => string[]) => setSkippedBy((all) => withSkipped(all, mode, f(skippedFor(all, mode))));
  // The page "Show different ideas" or "Start over" asked for: the button spins and the view scrolls only for that one.
  const [requested, setRequested] = useState<string | null>(null);
  const scrolledTo = useRef<string | null>(null);
  const scroll = useRef<ScrollViewInstance>(null);
  const ideasY = useRef(0);
  const gaps = useGaps(date, mode, meal, skipped);
  const stale = gaps.isPlaceholderData;
  const plan = usePlanMutations();
  const logFoods = useLogFoods();
  const logRecipe = useLogRecipe();
  // New ideas arrived after "Show different ideas": bring the first one into view (the summary above stays as it was).
  const pageKey = `${mode}|${skipped.join(',')}`;
  const rotating = requested === pageKey && gaps.isFetching;
  useEffect(() => {
    if (requested !== pageKey || gaps.isFetching || gaps.isPlaceholderData || !gaps.data || scrolledTo.current === pageKey) return;
    scrolledTo.current = pageKey;
    scroll.current?.scrollTo({ y: Math.max(0, ideasY.current - t.space.md), animated: true });
  }, [requested, pageKey, gaps.data, gaps.isFetching, gaps.isPlaceholderData, t.space.md]);
  const page = { padding: t.screenPadding, gap: t.space.lg, paddingBottom: t.space.huge };
  const shell = { flex: 1, backgroundColor: t.colors.background } as const;

  if (gaps.isLoading) return <ScrollView style={shell} contentContainerStyle={page}>{[0, 1, 2].map((i) => <Skeleton key={i} width="100%" height={160} radius={20} />)}</ScrollView>;
  if (gaps.error || !gaps.data) {
    return <ScrollView style={shell} contentContainerStyle={page}>
      <EmptyState icon={CloudOff} title="Couldn't load suggestions" body={gaps.error instanceof Error ? gaps.error.message : undefined} action={<PrimaryButton label="Try again" onPress={() => gaps.refetch()} />} />
    </ScrollView>;
  }
  const g = gaps.data;
  const kcalHeadline = calorieHeadline(g.remaining.calories, g.situation);
  const short = shortOn(g.gaps);
  const chips = modeChips(g.availableModes, mode);
  const showMeal = g.suggestions.length > 0 || g.nextDay.length > 0;
  const tomorrow = addDays(date, 1);

  const run = async (id: string, work: () => Promise<void>, ok: string) => {
    setBusy(id);
    try {
      await work();
      setDone((s) => new Set(s).add(id));
      snackbar({ message: ok });
    } catch (e) {
      snackbar({ message: e instanceof Error ? e.message : 'That didn’t work. Try again.' });
    } finally { setBusy(null); }
  };

  // Foods go in one all-or-nothing request; recipes are added one by one. Each step is remembered once saved.
  const once = async (step: string, work: () => Promise<unknown>) => {
    if (saved.current.has(step)) return;
    await work();
    saved.current.add(step);
  };
  const planItems = async (items: Pick<GapItem, 'foodId' | 'recipeId' | 'amount'>[], on: string) => {
    const p = planPayload(items);
    const base = `plan:${on}:${meal}`;
    if (p.foods.length) await once(`${base}:foods:${suggestionId(items)}`, () => plan.addFoods.mutateAsync({ date: on, meal, items: p.foods, key: `${base}:${suggestionId(items)}` }));
    for (const r of p.recipes) await once(`${base}:r:${r.recipeId}:${r.servings}`, () => plan.addRecipe.mutateAsync({ date: on, meal, recipeId: r.recipeId, servings: r.servings }));
  };
  const logItems = async (items: GapItem[]) => {
    const p = planPayload(items);
    const base = `log:${date}:${meal}`;
    if (p.foods.length) await once(`${base}:foods:${suggestionId(items)}`, () => logFoods.mutateAsync({ date, meal, items: p.foods, key: `${base}:${suggestionId(items)}` }));
    for (const r of p.recipes) await once(`${base}:r:${r.recipeId}:${r.servings}`, () => logRecipe.mutateAsync({ date, meal, recipeId: r.recipeId, servings: r.servings }));
  };
  const planned = (on: string) => `Planned for ${dayLabel(on).split(',')[0].toLowerCase()} · ${mealLabel(meal).toLowerCase()}. Log it when you eat it.`;

  const swap = (s: GapSwap) => run(`swap:${s.planEntryId}`, async () => {
    if (s.to.recipeId) await plan.swapRecipe.mutateAsync({ id: s.planEntryId, recipeId: s.to.recipeId, servings: s.to.amount });
    else if (s.to.foodId) await plan.swapFood.mutateAsync({ id: s.planEntryId, foodId: s.to.foodId, grams: s.to.amount });
  }, `Swapped ${s.fromName} for ${nice(s.to)}.`);

  const rotation = rotationState(g, skipped);
  const showDifferent = () => {
    if (rotating) return;
    const next = skipShown(skipped, g.suggestions);
    setRequested(`${mode}|${next.join(',')}`);
    setSkipped(() => next);
  };
  const startOver = () => { setRequested(`${mode}|`); setSkipped(() => []); };
  const empty = emptyCopy(g);
  const emptyIcon = g.emptyReason === 'Over' || g.emptyReason === 'AtTarget' || g.emptyReason === 'NeedsMet' ? CircleCheck : Sparkles;

  return (
    <ScrollView ref={scroll} style={[shell, stale ? { opacity: 0.7 } : null]} contentContainerStyle={page}>
      <AppCard sheen style={{ gap: t.space.sm }}>
        <AppText variant="label" tone="muted">{(date === today() ? 'TODAY' : dayLabel(date)).toUpperCase()}</AppText>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm }}>
          {kcalHeadline.over ? <Info size={22} color={t.colors.warningText} strokeWidth={2} /> : null}
          <AppText variant="display" numeric style={kcalHeadline.over ? { color: t.colors.warningText } : undefined}>{kcalHeadline.text}</AppText>
        </View>
        <AppText variant="body" tone="secondary" accessibilityLiveRegion="polite">{g.message}</AppText>
        <Macros n={g.remaining} />
        {short.length && g.situation !== 'Over' ? <AppText variant="caption" tone="muted">Short on {short.slice(0, 4).join(', ')}{short.length > 4 ? ` and ${short.length - 4} more` : ''}.</AppText> : null}
        {g.dataNotes.length > 0 ? (
          <View style={{ gap: t.space.xs }}>
            <TextButton
              label={showDataNotes ? 'Hide data limitations' : `${g.dataNotes.length} data ${g.dataNotes.length === 1 ? 'limitation' : 'limitations'} · View details`}
              icon={Info}
              onPress={() => setShowDataNotes((open) => !open)}
            />
            {showDataNotes ? g.dataNotes.map((n) => <AppText key={n} variant="caption" tone="muted">{n}</AppText>) : null}
          </View>
        ) : null}
      </AppCard>

      {gaps.isFetching && gaps.isPlaceholderData ? <AppText variant="caption" tone="muted" accessibilityLiveRegion="polite">Updating…</AppText> : null}

      {chips.length > 1 || mode !== 'BestMatch' ? (
        <View style={{ gap: t.space.xs }}>
          <AppText variant="label" tone="secondary">Show</AppText>
          <View style={{ flexDirection: 'row', gap: t.space.sm, flexWrap: 'wrap' }}>
            {chips.map((m) => <FilterChip key={m} label={MODE_LABEL[m]} selected={m === mode} onPress={() => setMode(m)} />)}
          </View>
        </View>
      ) : null}

      {showMeal ? (
        <View style={{ gap: t.space.xs }}>
          <AppText variant="label" tone="secondary">Add to</AppText>
          <View style={{ flexDirection: 'row', gap: t.space.sm, flexWrap: 'wrap' }}>
            {meals.map((m) => <FilterChip key={m} label={mealLabel(m)} selected={m === meal} onPress={() => setMeal(m)} />)}
          </View>
        </View>
      ) : null}

      <View onLayout={(e) => { ideasY.current = e.nativeEvent.layout.y; }} style={{ gap: t.space.lg }}>
      {g.suggestions.map((s) => {
        const sid = suggestionId(s.items);
        const addId = `add:${sid}:${meal}`;
        const logId = `log:${sid}:${meal}`;
        return (
          <SuggestionCard key={sid} s={s} meal={meal} added={done.has(addId)} adding={busy === addId} logged={done.has(logId)} logging={busy === logId}
            onPlan={() => run(addId, () => planItems(s.items, date), planned(date))}
            onLog={() => run(logId, () => logItems(s.items), `Logged for ${mealLabel(meal).toLowerCase()}.`)} />
        );
      })}

      </View>

      {rotation === 'more' ? (
        <SecondaryButton label="Show different ideas" icon={RefreshCw} loading={rotating} disabled={rotating} onPress={showDifferent} fullWidth />
      ) : rotation === 'end' ? (
        <View style={{ alignItems: 'center', gap: t.space.xs }}>
          <AppText variant="secondary" tone="secondary" align="center" accessibilityLiveRegion="polite">No more matching ideas right now.</AppText>
          {skipped.length > 0 ? <TextButton label="Start over" icon={RefreshCw} onPress={startOver} /> : null}
        </View>
      ) : null}

      {g.suggestions.length === 0 ? (
        <EmptyState icon={emptyIcon} title={empty.title} body={empty.body}
          action={g.emptyReason === 'Exhausted' && skipped.length > 0 ? <SecondaryButton label="Start over" icon={RefreshCw} loading={rotating} onPress={startOver} /> : undefined} />
      ) : null}

      {g.swaps.length > 0 ? (
        <View style={{ gap: t.space.sm }}>
          <AppText variant="sectionTitle" accessibilityRole="header">Lighter swaps for what’s planned</AppText>
          {g.swaps.map((s) => (
            <AppCard key={s.planEntryId} style={{ gap: t.space.sm }}>
              <AppText variant="secondary" tone="secondary">Instead of {s.fromName} · {Math.round(s.fromCalories)} kcal</AppText>
              <AppText variant="cardTitle">{nice(s.to)}</AppText>
              <AppText variant="caption" tone="muted">{s.to.portion} · {Math.round(s.to.nutrition.calories)} kcal</AppText>
              <Reasons reasons={s.reasons} />
              <SecondaryButton label={done.has(`swap:${s.planEntryId}`) ? 'Swapped' : 'Swap'} icon={done.has(`swap:${s.planEntryId}`) ? Check : ArrowLeftRight}
                disabled={done.has(`swap:${s.planEntryId}`)} loading={busy === `swap:${s.planEntryId}`} onPress={() => swap(s)} fullWidth />
            </AppCard>
          ))}
        </View>
      ) : null}

      {g.nextDay.length > 0 ? (
        <View style={{ gap: t.space.sm }}>
          <AppText variant="sectionTitle" accessibilityRole="header">Ideas for tomorrow</AppText>
          <AppText variant="secondary" tone="secondary">Foods you already eat that are real sources of what ran short today.</AppText>
          {g.nextDay.map((tip: GapTip) => (
            <AppCard key={tip.nutrientId} style={{ gap: t.space.sm }}>
              <AppText variant="cardTitle">{tip.name}</AppText>
              {tip.items.map((it: GapTipItem, k) => {
                const id = `tip:${tip.nutrientId}:${k}`;
                const isDone = done.has(`${id}:${meal}`);
                return (
                  <View key={id} style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm, minHeight: 52 }}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <AppText variant="body" numberOfLines={2}>{nice(it)}</AppText>
                      <AppText variant="caption" tone="muted">{it.portion} · about {fmtAmount(it.nutrientAmount)} {tip.unit} ({it.dailySharePercent}% of daily)</AppText>
                    </View>
                    <TextButton label={isDone ? 'Planned' : 'Plan tomorrow'} icon={isDone ? Check : CalendarPlus}
                      onPress={() => { if (!done.has(`${id}:${meal}`) && busy === null) void run(`${id}:${meal}`, () => planItems([it], tomorrow), planned(tomorrow)); }} />
                  </View>
                );
              })}
            </AppCard>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

function Macros({ n }: { n: { calories: number; protein: number; carbs: number; fat: number } }) {
  const t = useTheme();
  const parts = [
    { label: 'protein', m: macroText(n.protein), color: t.colors.protein },
    { label: 'carbs', m: macroText(n.carbs), color: t.colors.carbs },
    { label: 'fat', m: macroText(n.fat), color: t.colors.fat },
  ];
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: t.space.lg, rowGap: t.space.xs }}>
      {parts.map((p) => (
        <View key={p.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: p.color }} />
          <AppText variant="secondary" tone="secondary" numeric>{p.label} {p.m.text}</AppText>
        </View>
      ))}
    </View>
  );
}

function Reasons({ reasons }: { reasons: { code: string; text: string }[] }) {
  const t = useTheme();
  const shown = reasons.filter((r) => !['favorite', 'recipe', 'pantry', 'frequent'].includes(r.code));
  if (shown.length === 0) return null;
  return (
    <View style={{ gap: 4 }}>
      {shown.map((r) => (
        <View key={r.text} style={{ flexDirection: 'row', gap: t.space.sm, alignItems: 'flex-start' }}>
          <Check size={16} color={t.colors.primary} strokeWidth={2.4} style={{ marginTop: 2 }} />
          <AppText variant="secondary" tone="secondary" style={{ flex: 1 }}>{r.text}</AppText>
        </View>
      ))}
    </View>
  );
}

function SuggestionCard({ s, meal, added, adding, logged, logging, onPlan, onLog }: {
  s: GapSuggestion; meal: Meal; added: boolean; adding: boolean; logged: boolean; logging: boolean; onPlan: () => void; onLog: () => void;
}) {
  const t = useTheme();
  const badges = originBadges(s.reasons);
  return (
    <AppCard padded={false}>
      <View style={{ padding: t.space.lg, paddingBottom: t.space.sm, gap: t.space.xs }}>
        <View style={{ flexDirection: 'row', gap: t.space.xs, flexWrap: 'wrap' }}>
          <Badge label={s.category} tone="primary" />
          {badges.map((b) => <Badge key={b} label={b} />)}
        </View>
        <AppText variant="cardTitle" numberOfLines={3}>{s.items.map(nice).join(' + ')}</AppText>
        <AppText variant="secondary" tone="secondary" numeric>{Math.round(s.adds.calories)} kcal · {fmtAmount(s.adds.protein)} g protein</AppText>
      </View>
      {s.items.map((it, j) => (
        <View key={j} style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.md, minHeight: 52, paddingHorizontal: t.space.lg, paddingVertical: t.space.xs, borderTopWidth: 1, borderTopColor: t.colors.border }}>
          <View style={{ flex: 1, gap: 2 }}>
            <AppText variant="body" numberOfLines={2}>{nice(it)}</AppText>
            <AppText variant="caption" tone="muted">{it.portion}</AppText>
          </View>
          <AppText variant="bodyStrong" numeric>{Math.round(it.nutrition.calories)}</AppText>
        </View>
      ))}
      <View style={{ padding: t.space.lg, paddingTop: t.space.md, gap: t.space.md, borderTopWidth: 1, borderTopColor: t.colors.border }}>
        <Reasons reasons={s.reasons} />
        {s.effects.length > 0 ? (
          <View style={{ gap: 2 }}>
            <AppText variant="label" tone="muted">AFTER THIS</AppText>
            {s.effects.map((e) => <AppText key={e.nutrientId} variant="caption" tone="secondary">{effectLine(e)}</AppText>)}
          </View>
        ) : null}
        <PrimaryButton label={added ? 'Planned' : `Plan for ${mealLabel(meal).toLowerCase()}`} icon={added ? Check : CalendarClock}
          disabled={added} loading={adding} onPress={onPlan} fullWidth />
        <View style={{ alignItems: 'center' }}>
          <TextButton label={logged ? 'Logged' : 'Log now'} icon={logged ? Check : undefined} onPress={() => { if (!logged && !logging) onLog(); }} />
        </View>
      </View>
    </AppCard>
  );
}
