import { useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { useDeleteEntry, useFoodSearch, useLogFoods, usePlanMutations } from '@/api/hooks';
import type { AssistantResponse, Food, Measure } from '@/api/types';
import { QuantityPicker, type QuantityValue } from '@/features/quantity/QuantityPicker';
import { formatQuantity, matchMeasure, parseQuantity } from '@/features/quantity/quantity';
import { AppCard, AppText, Badge, BottomSheet, FilterChip, PrimaryButton, SearchField, SecondaryButton, TextButton, useSnackbar } from '@/components/ds';
import { CalendarClock, Check, ChevronRight, CircleAlert, Trash2, Undo2 } from '@/components/ds/icons';
import { friendlyFoodName } from '@/lib/foodName';
import { dayLabel, mealForNow, meals, today, type Meal } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { useTheme } from '@/theme/ThemeProvider';
import {
  amountOptions, blockers, draftFrom, otherPreparationIndex, preview, replaceItem, selectMatch, selectedMatch, setAmount, setRemoved, toRequest, totals, withPickedFood,
  type DraftItem,
} from './draft';

/** A fresh random key per review; computed once, in a state initializer, so renders stay pure. */
const newSubmitKey = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const mealLabel = (m: Meal) => (m === 'Snack' ? 'Snacks' : m);
const r0 = (n: number) => Math.round(n);

/**
 * One review for everything the assistant found: each food with its USDA match, amount and calories, combined
 * totals, a meal choice, and a single Log all (or Plan all). Nothing is saved until you tap it, and everything is
 * saved together or not at all. Planned food goes to the plan endpoints and is never counted as eaten.
 */
export function ReviewCard({ response }: { response: AssistantResponse }) {
  const t = useTheme();
  const snackbar = useSnackbar();
  const planning = response.intent === 'PlanMeal';
  const [items, setItems] = useState(() => draftFrom(response.foodMatches));
  const [meal, setMeal] = useState<Meal>((response.meal as Meal | null) ?? (planning ? 'Dinner' : mealForNow()));
  const [editing, setEditing] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ count: number; ids: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const logFoods = useLogFoods();
  const plan = usePlanMutations();
  const delEntry = useDeleteEntry();
  // One key per review: a double tap or a retry after a dropped connection returns the first result instead of saving twice.
  const [submitKey] = useState(newSubmitKey);
  const submitting = useRef(false);

  const sum = useMemo(() => totals(items), [items]);
  const blocked = blockers(items);
  const included = items.filter((i) => !i.removed);
  const busy = logFoods.isPending || plan.addFoods.isPending;
  const date = response.date;
  const when = date === today() ? 'today' : dayLabel(date).split(',')[0];
  const editingItem = items.find((i) => i.key === editing) ?? null;

  const update = (next: DraftItem) => setItems((xs) => replaceItem(xs, next));

  const commit = async () => {
    if (submitting.current) return;
    submitting.current = true;
    setError(null);
    try {
      const body = { date, meal, items: toRequest(items), key: submitKey };
      const ids = planning ? (await plan.addFoods.mutateAsync(body)).map((e) => e.id) : (await logFoods.mutateAsync(body)).map((e) => e.id);
      haptic.success();
      setSaved({ count: ids.length, ids });
      snackbar({
        message: planning ? `Planned ${ids.length} ${ids.length === 1 ? 'food' : 'foods'} for ${when}` : `Logged ${ids.length} ${ids.length === 1 ? 'food' : 'foods'} to ${mealLabel(meal).toLowerCase()}`,
        actionLabel: 'Undo',
        onAction: () => {
          ids.forEach((id) => (planning ? plan.remove.mutate(id) : delEntry.mutate(id)));
          setSaved(null);
        },
      });
    } catch (e) {
      // Nothing was saved: the server saves all foods together or none.
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      submitting.current = false;
    }
  };

  if (saved) {
    return (
      <AppCard style={{ gap: t.space.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm }} accessibilityLiveRegion="polite">
          <Check size={20} strokeWidth={2.2} color={t.colors.success} />
          <AppText variant="bodyStrong" style={{ flex: 1 }}>
            {planning ? `Planned for ${when} · ${mealLabel(meal).toLowerCase()}` : `Logged to ${mealLabel(meal).toLowerCase()}`} · {r0(sum.calories)} kcal
          </AppText>
        </View>
        <View style={{ flexDirection: 'row' }}>
          <TextButton label={planning ? 'View week' : 'View today'} onPress={() => router.push(planning ? '/plan' : '/')} />
        </View>
      </AppCard>
    );
  }

  return (
    <AppCard padded={false}>
      <View style={{ padding: t.space.lg, paddingBottom: t.space.sm, gap: t.space.xs }}>
        {planning ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <CalendarClock size={16} strokeWidth={2} color={t.colors.primary} />
            <AppText variant="label" tone="primary">Planning for {dayLabel(date)} — not logged as eaten</AppText>
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: t.space.sm, flexWrap: 'wrap' }}>
          <AppText variant="cardTitle">{included.length} {included.length === 1 ? 'food' : 'foods'}</AppText>
          <AppText variant="sectionTitle" numeric accessibilityLabel={`${r0(sum.calories)} calories in total`}>{r0(sum.calories)} kcal</AppText>
        </View>
        <MacroSummary protein={sum.protein} carbs={sum.carbs} fat={sum.fat} />
      </View>

      <View>
        {items.map((item) => (
          <ReviewRow key={item.key} item={item} onPress={() => { haptic.select(); setEditing(item.key); }} onRestore={() => update(setRemoved(item, false))}
            onSwitchPreparation={() => { const i = otherPreparationIndex(item); if (i >= 0) { haptic.select(); update(selectMatch(item, i)); } }} />
        ))}
      </View>

      <View style={{ padding: t.space.lg, gap: t.space.md }}>
        <View style={{ gap: t.space.xs }}>
          <AppText variant="label" tone="secondary">{planning ? `Meal on ${when}` : 'Meal'}</AppText>
          {!response.meal ? <AppText variant="caption" tone="muted">No meal was mentioned, so this is chosen from the time of day. Tap another to change it.</AppText> : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space.sm }}>
            {meals.map((m) => <FilterChip key={m} label={mealLabel(m)} selected={m === meal} onPress={() => { haptic.select(); setMeal(m); }} />)}
          </View>
        </View>
        {blocked.length ? (
          <View style={{ flexDirection: 'row', gap: t.space.sm, alignItems: 'flex-start' }} accessibilityLiveRegion="polite">
            <CircleAlert size={18} strokeWidth={2} color={t.colors.warning} />
            <AppText variant="secondary" tone="secondary" style={{ flex: 1 }}>
              {blocked.length === 1 ? `Choose ${!selectedMatch(blocked[0]) ? 'a food' : 'an amount'} for “${blocked[0].group.foodQuery}”, or remove it.` : `${blocked.length} foods need a food or an amount.`}
            </AppText>
          </View>
        ) : null}
        {error ? <AppText variant="secondary" tone="error" accessibilityLiveRegion="polite">{error}</AppText> : null}
        <PrimaryButton
          label={`${planning ? 'Plan all' : 'Log all'}${included.length ? ` · ${r0(sum.calories)} kcal` : ''}`}
          icon={planning ? CalendarClock : Check}
          disabled={included.length === 0 || blocked.length > 0}
          loading={busy}
          onPress={commit}
          fullWidth
        />
      </View>

      <FoodEditSheet item={editingItem} onChange={update} onClose={() => setEditing(null)} />
    </AppCard>
  );
}

function MacroSummary({ protein, carbs, fat }: { protein: number; carbs: number; fat: number }) {
  const t = useTheme();
  const parts = [
    { label: 'Protein', value: protein, color: t.colors.protein },
    { label: 'Carbs', value: carbs, color: t.colors.carbs },
    { label: 'Fat', value: fat, color: t.colors.fat },
  ];
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: t.space.lg, rowGap: 2 }} accessible
      accessibilityLabel={parts.map((p) => `${p.label} ${r0(p.value)} grams`).join(', ')}>
      {parts.map((p) => (
        <View key={p.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: p.color }} />
          <AppText variant="secondary" tone="secondary" numeric>{p.label} <AppText variant="secondary" numeric style={{ fontWeight: '600' }}>{r0(p.value)} g</AppText></AppText>
        </View>
      ))}
    </View>
  );
}

function ReviewRow({ item, onPress, onRestore, onSwitchPreparation }: { item: DraftItem; onPress: () => void; onRestore: () => void; onSwitchPreparation: () => void }) {
  const t = useTheme();
  const m = selectedMatch(item);
  const p = preview(item);
  const name = m ? friendlyFoodName(m.food.name) : item.group.foodQuery;

  if (item.removed) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 52, paddingLeft: t.space.lg, paddingRight: t.space.sm, borderTopWidth: 1, borderTopColor: t.colors.border }}>
        <AppText variant="secondary" tone="muted" style={{ flex: 1, textDecorationLine: 'line-through' }} numberOfLines={1}>{name}</AppText>
        <TextButton label="Restore" icon={Undo2} tone="secondary" onPress={onRestore} />
      </View>
    );
  }

  const status = !m ? { label: 'No match', tone: 'warning' as const }
    : item.grams == null ? { label: 'Needs amount', tone: 'warning' as const }
    : m.confidence < 0.5 ? { label: 'Check match', tone: 'warning' as const }
    : item.status === 'Assumed' ? { label: 'Assumed amount', tone: 'neutral' as const }
    : null;

  const prep = m?.preparation;
  const otherIndex = otherPreparationIndex(item);
  const switchLabel = prep?.otherState === 'Cooked' ? 'Use cooked instead' : prep?.otherState === 'Raw' ? 'Use raw instead' : 'Switch version';

  return (
    <View style={{ borderTopWidth: 1, borderTopColor: t.colors.border }}>
    <Pressable onPress={onPress} accessibilityRole="button"
      accessibilityLabel={`${name}, ${item.amountLabel ?? 'no amount'}, ${p ? `${r0(p.calories)} calories` : 'calories unknown'}${status ? `, ${status.label}` : ''}`}
      accessibilityHint="Change the match or the amount"
      style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: t.space.md, minHeight: 64, paddingVertical: t.space.sm, paddingLeft: t.space.lg, paddingRight: t.space.sm }, pressed && { backgroundColor: t.colors.surfaceMuted }]}>
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="body" numberOfLines={2}>{name}</AppText>
        <AppText variant="secondary" tone="secondary" numberOfLines={1}>
          {item.amountLabel ?? 'Choose amount'}{item.grams != null && !/\bg$/.test(item.amountLabel ?? '') ? ` · ${r0(item.grams)} g` : ''}
        </AppText>
        {m && friendlyFoodName(m.food.name) !== m.food.name ? <AppText variant="caption" tone="muted" numberOfLines={1}>{m.food.name}</AppText> : null}
        {status ? <View style={{ flexDirection: 'row', marginTop: 2 }}><Badge label={status.label} tone={status.tone} /></View> : null}
      </View>
      <AppText variant="bodyStrong" numeric>{p ? r0(p.calories) : '—'}</AppText>
      <ChevronRight size={18} strokeWidth={1.8} color={t.colors.textMuted} />
    </Pressable>
    {prep?.note ? (
      <View style={{ paddingHorizontal: t.space.lg, paddingBottom: t.space.sm, gap: 2 }}>
        <AppText variant="caption" tone="secondary">{prep.note}</AppText>
        {otherIndex >= 0 ? <View style={{ flexDirection: 'row' }}><TextButton label={switchLabel} onPress={onSwitchPreparation} /></View> : null}
      </View>
    ) : null}
    </View>
  );
}

/** Change the match or the amount for one food. Changes apply as you make them, so closing never loses them. */
function FoodEditSheet({ item, onChange, onClose }: { item: DraftItem | null; onChange: (i: DraftItem) => void; onClose: () => void }) {
  const t = useTheme();
  const [last, setLast] = useState(item);
  if (item && item !== last) setLast(item);
  const it = item ?? last;
  if (!it) return null;

  const m = selectedMatch(it);
  const p = preview(it);

  return (
    <BottomSheet visible={!!item} onClose={onClose} title={m ? friendlyFoodName(m.food.name) : `“${it.group.foodQuery}”`}
      footer={<>
        <PrimaryButton label="Done" onPress={onClose} fullWidth />
        <SecondaryButton label="Remove from this meal" icon={Trash2} tone="danger" fullWidth onPress={() => { onChange(setRemoved(it, true)); onClose(); }} />
      </>}>
      <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ gap: t.space.lg, paddingBottom: t.space.sm }} keyboardShouldPersistTaps="handled">
        <AppText variant="secondary" tone="muted">You said “{it.group.text}”</AppText>

        {m ? <AmountEditor key={`${it.key}:${it.matchIndex}`} item={it} food={m.food} onChange={onChange} /> : null}
        {m ? (
          <AppText variant="secondary" tone="secondary" numeric>
            {it.grams != null ? `${r0(it.grams)} g · ${p ? r0(p.calories) : '—'} kcal` : 'Choose an amount to see calories'}
          </AppText>
        ) : null}

        <View style={{ gap: t.space.xs }}>
          <AppText variant="label" tone="secondary">{it.group.matches.length ? 'Match' : 'No food matched what you said'}</AppText>
          {it.group.matches.slice(0, 5).map((match, i) => {
            const selected = i === it.matchIndex;
            return (
              <Pressable key={`${match.food.id}-${i}`} onPress={() => { haptic.select(); onChange(selectMatch(it, i)); }}
                accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={`${match.food.name}, ${r0(match.food.per100g.calories)} calories per 100 grams`}
                style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: t.space.md, minHeight: 52, paddingHorizontal: t.space.md, paddingVertical: t.space.sm, borderRadius: t.radii.button, borderWidth: 1, borderColor: selected ? t.colors.primary : t.colors.border },
                  selected && { backgroundColor: t.colors.primaryLight }, pressed && { backgroundColor: t.colors.surfaceMuted }]}>
                <View style={{ flex: 1, gap: 2 }}>
                  <AppText variant="body" numberOfLines={2} style={selected ? { color: t.colors.text } : undefined}>{match.food.name}{match.food.brand ? ` · ${match.food.brand}` : ''}</AppText>
                  <AppText variant="caption" tone="muted" numeric>
                    {r0(match.food.per100g.calories)} kcal / 100 g{match.food.quality === 'Verified' ? ' · USDA verified' : ''}{match.confidence < 0.5 ? ' · weak match' : ''}
                  </AppText>
                </View>
                {selected ? <Check size={20} strokeWidth={2.2} color={t.colors.primary} /> : null}
              </Pressable>
            );
          })}
          <OtherFoodSearch initial={it.group.foodQuery} onPick={(food) => { haptic.select(); onChange(withPickedFood(it, food)); }} />
        </View>
      </ScrollView>
    </BottomSheet>
  );
}

function OtherFoodSearch({ initial, onPick }: { initial: string; onPick: (f: Food) => void }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(initial);
  const results = useFoodSearch(open ? text.trim() : '');
  if (!open) return <TextButton label="Search for another food" tone="secondary" onPress={() => setOpen(true)} />;
  return (
    <View style={{ gap: t.space.xs, marginTop: t.space.xs }}>
      <SearchField value={text} onChangeText={setText} onClear={() => setText('')} placeholder="Search foods" autoFocus accessibilityLabel="Search for another food" />
      {results.isFetching ? <AppText variant="caption" tone="muted">Searching…</AppText> : null}
      {(results.data ?? []).slice(0, 6).map((f) => (
        <Pressable key={f.id} onPress={() => onPick(f)} accessibilityRole="button" accessibilityLabel={`Use ${f.name}`}
          style={({ pressed }) => [{ minHeight: 48, justifyContent: 'center', paddingHorizontal: t.space.md, paddingVertical: t.space.xs, borderRadius: t.radii.button }, pressed && { backgroundColor: t.colors.surfaceMuted }]}>
          <AppText variant="body" numberOfLines={2}>{f.name}{f.brand ? ` · ${f.brand}` : ''}</AppText>
          <AppText variant="caption" tone="muted" numeric>{Math.round(f.per100g.calories)} kcal / 100 g</AppText>
        </Pressable>
      ))}
    </View>
  );
}

/**
 * Amount in one of the measures the server says this food supports (the same picker used for logging and editing).
 * Falls back to the food's raw portions plus g/oz for a food sent without measures.
 */
function AmountEditor({ item, food, onChange }: { item: DraftItem; food: Food; onChange: (i: DraftItem) => void }) {
  const measures: Measure[] = food.measures?.length ? food.measures
    : amountOptions(food.portions).map((o) => ({ unit: o.label, label: o.label, plural: o.label, base: o.grams, kind: o.label === 'g' || o.label === 'oz' ? 'Mass' : 'Count', source: null, countable: false }));
  const base = food.baseUnit ?? 'g';
  // Start on the measure you said if this food has it, else its first one; the amount keeps the same weight.
  const said = (item.amountLabel ?? '').replace(/^[\d.,/ ]+\s*/, '');
  const [value, setValue] = useState<QuantityValue>(() => {
    const m = matchMeasure(measures, said) ?? measures[0];
    return { unit: m?.unit ?? base, text: item.grams != null && m && m.base > 0 ? formatQuantity(item.grams / m.base) : '' };
  });
  const change = (v: QuantityValue) => {
    setValue(v);
    const q = parseQuantity(v.text);
    const m = matchMeasure(measures, v.unit);
    if (q !== null && q > 0 && m) onChange(setAmount(item, q, { label: Math.abs(q - 1) < 1e-9 ? m.label : m.plural, grams: m.base, unit: food.measures?.length ? m.unit : undefined }));
  };
  const q = parseQuantity(value.text);
  return <QuantityPicker measures={measures} value={value} onChange={change} baseUnit={base}
    error={value.text.trim() && (q === null || q <= 0) ? 'Enter an amount, like 12, 0.5 or 1/2.' : null} />;
}
