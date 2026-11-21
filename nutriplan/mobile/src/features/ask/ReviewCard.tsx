import { useMemo, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useDeleteEntry, useFoodSearch, useLogFoods, usePlanMutations } from '@/api/hooks';
import type { AssistantResponse, Food } from '@/api/types';
import { AppCard, AppText, Badge, BottomSheet, FilterChip, IconButton, PrimaryButton, SearchField, SecondaryButton, TextButton, useSnackbar } from '@/components/ds';
import { CalendarClock, Check, ChevronRight, CircleAlert, Minus, Plus, Trash2, Undo2 } from '@/components/ds/icons';
import { friendlyFoodName } from '@/lib/foodName';
import { dayLabel, mealForNow, meals, today, type Meal } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { useTheme } from '@/theme/ThemeProvider';
import {
  amountOptions, blockers, draftFrom, preview, replaceItem, selectMatch, selectedMatch, setAmount, setRemoved, toRequest, totals, withPickedFood,
  type AmountOption, type DraftItem,
} from './draft';

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

  const sum = useMemo(() => totals(items), [items]);
  const blocked = blockers(items);
  const included = items.filter((i) => !i.removed);
  const busy = logFoods.isPending || plan.addFoods.isPending;
  const date = response.date;
  const when = date === today() ? 'today' : dayLabel(date).split(',')[0];
  const editingItem = items.find((i) => i.key === editing) ?? null;

  const update = (next: DraftItem) => setItems((xs) => replaceItem(xs, next));

  const commit = async () => {
    setError(null);
    try {
      const body = { date, meal, items: toRequest(items) };
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
        {items.map((item) => <ReviewRow key={item.key} item={item} onPress={() => { haptic.select(); setEditing(item.key); }} onRestore={() => update(setRemoved(item, false))} />)}
      </View>

      <View style={{ padding: t.space.lg, gap: t.space.md }}>
        <View style={{ gap: t.space.xs }}>
          <AppText variant="label" tone="secondary">{planning ? `Meal on ${when}` : 'Meal'}</AppText>
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

function ReviewRow({ item, onPress, onRestore }: { item: DraftItem; onPress: () => void; onRestore: () => void }) {
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

  return (
    <Pressable onPress={onPress} accessibilityRole="button"
      accessibilityLabel={`${name}, ${item.amountLabel ?? 'no amount'}, ${p ? `${r0(p.calories)} calories` : 'calories unknown'}${status ? `, ${status.label}` : ''}`}
      accessibilityHint="Change the match or the amount"
      style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: t.space.md, minHeight: 64, paddingVertical: t.space.sm, paddingLeft: t.space.lg, paddingRight: t.space.sm, borderTopWidth: 1, borderTopColor: t.colors.border }, pressed && { backgroundColor: t.colors.surfaceMuted }]}>
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
  const options = m ? amountOptions(m.food.portions) : [];

  return (
    <BottomSheet visible={!!item} onClose={onClose} title={m ? friendlyFoodName(m.food.name) : `“${it.group.foodQuery}”`}
      footer={<>
        <PrimaryButton label="Done" onPress={onClose} fullWidth />
        <SecondaryButton label="Remove from this meal" icon={Trash2} tone="danger" fullWidth onPress={() => { onChange(setRemoved(it, true)); onClose(); }} />
      </>}>
      <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ gap: t.space.lg, paddingBottom: t.space.sm }} keyboardShouldPersistTaps="handled">
        <AppText variant="secondary" tone="muted">You said “{it.group.text}”</AppText>

        {m ? <AmountEditor key={`${it.key}:${it.matchIndex}`} item={it} options={options} onChange={onChange} /> : null}
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

/** Count × unit, where units are this food's USDA portions plus grams and ounces. Grams come from USDA data only. */
function AmountEditor({ item, options, onChange }: { item: DraftItem; options: AmountOption[]; onChange: (i: DraftItem) => void }) {
  const t = useTheme();
  // Start on the unit you said if this food has it, else its first portion (or grams).
  const said = (item.amountLabel ?? '').replace(/^[\d.]+\s*/, '').toLowerCase();
  const initial = options.find((o) => o.label.toLowerCase() === said) ?? (item.grams != null && said === 'g' ? options.find((o) => o.label === 'g') : undefined) ?? options[0];
  const [unit, setUnit] = useState<AmountOption>(initial);
  const [count, setCount] = useState(() => (item.grams != null && unit ? String(Math.round((item.grams / unit.grams) * 100) / 100) : ''));
  const step = unit?.label === 'g' ? 10 : unit?.label === 'oz' ? 1 : 0.5;
  const apply = (c: string, u: AmountOption) => { const n = Number(c); if (n > 0) onChange(setAmount(item, n, u)); };

  if (!unit) return null;
  return (
    <View style={{ gap: t.space.sm }}>
      <AppText variant="label" tone="secondary">Amount</AppText>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.md }}>
        <IconButton icon={Minus} label="Less" variant="outline" disabled={!(Number(count) - step > 0)}
          onPress={() => { const c = String(Math.round((Number(count) - step) * 100) / 100); setCount(c); apply(c, unit); }} />
        <TextInput value={count} onChangeText={(v) => { setCount(v); apply(v, unit); }} keyboardType="decimal-pad" placeholder="0"
          placeholderTextColor={t.colors.textMuted} accessibilityLabel={`Amount in ${unit.label}`}
          style={[t.type.sectionTitle, { flex: 1, minWidth: 0, textAlign: 'center', color: t.colors.text, minHeight: 48, borderRadius: t.radii.button, backgroundColor: t.colors.surfaceMuted }]} />
        <IconButton icon={Plus} label="More" variant="outline"
          onPress={() => { const c = String(Math.round(((Number(count) || 0) + step) * 100) / 100); setCount(c); apply(c, unit); }} />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space.sm }}>
        {options.map((o) => (
          <FilterChip key={o.label} label={o.label} selected={o.label === unit.label}
            onPress={() => {
              haptic.select();
              // Keep the same weight when switching units, so changing "1 cup" to grams shows the grams, not "1 g".
              const c = item.grams != null ? String(Math.round((item.grams / o.grams) * 100) / 100) : count;
              setUnit(o); setCount(c); apply(c, o);
            }} />
        ))}
      </View>
    </View>
  );
}
