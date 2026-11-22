import { useState } from 'react';
import { Keyboard, ScrollView, View } from 'react-native';
import { useFood, useNutrientCatalog } from '@/api/hooks';
import type { DiaryEntry } from '@/api/types';
import { AppText, BottomSheet, FilterChip, PrimaryButton, SecondaryButton, TextButton } from '@/components/ds';
import { Trash2 } from '@/components/ds/icons';
import { QuantityPicker } from '@/features/quantity/QuantityPicker';
import { checkQuantity, formatQuantity, initialSelection, matchMeasure, measuresForItem, parseQuantity, roundAmount, scaleFactor } from '@/features/quantity/quantity';
import { meals, type Meal } from '@/lib/format';
import { friendlyFoodName } from '@/lib/foodName';
import { useTheme } from '@/theme/ThemeProvider';
import { snapshotNutrition } from './snapshotNutrition';

/** What's being typed: kept by the caller per entry, so dismissing the sheet (or a failed save) loses nothing. */
export type EntryDraft = { text: string; unit: string; meal: Meal };

/** Only what changed. The amount always travels with its unit; the server converts and is authoritative. */
export type EntryChange = { amount?: number; unit?: string; meal?: Meal };

/**
 * Edit a logged food: type the amount, pick a measure the food really supports, move it to another meal, or delete.
 * Nutrition updates as you type, scaled from what was logged (exactly as the server will scale it).
 */
export function EntrySheet({ entry, draft, onDraft, onClose, onSave, onDelete, saving }: {
  entry: DiaryEntry | null;
  draft: EntryDraft | null;
  onDraft: (d: EntryDraft) => void;
  onClose: () => void;
  onSave: (entry: DiaryEntry, change: EntryChange) => void;
  onDelete: (entry: DiaryEntry) => void;
  saving?: boolean;
}) {
  const t = useTheme();
  const [showNutrition, setShowNutrition] = useState(false);
  const [entryId, setEntryId] = useState(entry?.id);
  if (entry?.id !== entryId) {
    setEntryId(entry?.id);
    setShowNutrition(false);
  }
  const [lastEntry, setLastEntry] = useState(entry);
  if (entry && entry !== lastEntry) setLastEntry(entry);
  const e = entry ?? lastEntry; // keep content during the closing animation
  const foodId = e?.item.kind === 'Food' ? e.item.foodId ?? '' : '';
  const food = useFood(foodId, !!foodId);
  const catalog = useNutrientCatalog(!!entry && showNutrition);
  if (!e) return null;

  const item = e.item;
  const editableAmount = item.kind !== 'QuickCalories' && item.quantity > 0;
  const measures = measuresForItem(item, food.data?.measures);
  const start = initialSelection(item, measures);
  const d = draft ?? { ...start, meal: e.meal };
  const measure = matchMeasure(measures, d.unit) ?? measures[0];
  const qty = parseQuantity(d.text);
  // Changed only if what's shown was changed: a stored 0.3333 shows as 0.33 and isn't a change until edited.
  const amountChanged = editableAmount && (d.text.trim() !== start.text || (measure?.unit ?? d.unit) !== start.unit);
  const check = amountChanged ? checkQuantity(qty, measure, item.kind === 'Recipe', food.data?.baseUnit ?? 'g') : null;
  const factor = !amountChanged ? 1 : check?.ok && measure ? scaleFactor(item, qty!, measure, measures) : null;
  const error = !amountChanged ? null
    : check && !check.ok ? check.message
    : factor === null ? 'This entry’s original amount can’t be converted to that measure. Change it in its own measure.'
    : null;
  const f = factor ?? 1;
  const n = item.nutrition;
  const mealChanged = d.meal !== e.meal;
  const changed = amountChanged || mealChanged;
  const canSave = !saving && (!amountChanged || error === null);

  const save = () => {
    if (!canSave) return;
    Keyboard.dismiss();
    if (!changed) return onClose();
    onSave(e, {
      amount: amountChanged ? roundAmount(qty!) : undefined,
      unit: amountChanged ? measure!.unit : undefined,
      meal: mealChanged ? d.meal : undefined,
    });
  };

  const shortName = item.kind === 'Food' ? friendlyFoodName(item.name) : item.name;
  const showFull = shortName !== item.name.trim(); // the full USDA description, when the list shows a shorter name

  return (
    <BottomSheet
      visible={!!entry}
      onClose={onClose}
      title={shortName}
      // Opening the measure list scrolls inside the editor instead of pushing the header up (#52). Not re-measured when the
      // food's measures arrive: the closed picker is the same size either way, and the list may already be open by then.
      steadyKey={`${e.id}:${showNutrition ? 'nutrition' : 'editor'}`}
      footer={showNutrition ? <SecondaryButton label="Back to editor" onPress={() => setShowNutrition(false)} fullWidth /> : <>
        <PrimaryButton label={changed ? 'Save changes' : 'Done'} onPress={save} loading={saving} disabled={!canSave} fullWidth />
        <SecondaryButton label="Delete" icon={Trash2} tone="danger" onPress={() => onDelete(e)} disabled={saving} fullWidth />
      </>}
    >
      <ScrollView testID="entry-editor-scroll" style={{ flexShrink: 1 }} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: t.space.lg, paddingBottom: t.space.xs }}>
        {showNutrition ? <>
          <AppText variant="sectionTitle" accessibilityRole="header">Saved nutrition snapshot</AppText>
          <AppText variant="secondary" tone="secondary">
            {item.kind === 'QuickCalories' ? 'Saved for this quick entry.' : `Saved for ${item.quantity} ${item.unit}.`} Unsaved quantity changes are not included.
          </AppText>
          {item.kind === 'Recipe' ? <AppText variant="secondary" tone="secondary">Recipe values may be incomplete if ingredients or nutrients were missing.</AppText> : null}
          {catalog.isLoading ? <AppText tone="secondary">Loading nutrients…</AppText> : catalog.isError || !catalog.data ? <>
            <AppText tone="secondary">Could not load the nutrient catalog.</AppText>
            <TextButton label="Retry" onPress={() => { void catalog.refetch(); }} />
          </> : snapshotNutrition(item.nutrition, catalog.data).map((section) => (
            <View key={section.title} style={{ gap: t.space.sm }}>
              <AppText variant="label" tone="secondary" accessibilityRole="header">{section.title}</AppText>
              {section.rows.map((row) => (
                <View key={row.id} style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', columnGap: t.space.md }}>
                  <AppText variant="secondary" style={{ flexShrink: 1 }}>{row.name}</AppText>
                  <AppText variant="secondary" tone="secondary" numeric>{row.value}</AppText>
                </View>
              ))}
            </View>
          ))}
        </> : <>
        {showFull ? <AppText variant="caption" tone="muted" selectable>{item.name}</AppText> : null}
        {editableAmount ? (
          <QuantityPicker measures={measures} value={{ text: d.text, unit: measure?.unit ?? d.unit }} baseUnit={food.data?.baseUnit ?? 'g'}
            onChange={(v) => onDraft({ ...d, ...v })} error={error} onSubmit={save} />
        ) : (
          <AppText variant="secondary" tone="secondary">Quick entry: no amount to change.</AppText>
        )}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: t.space.md, rowGap: 2 }} accessibilityLiveRegion="polite">
          <AppText variant="sectionTitle" numeric>{Math.round(n.calories * f)} kcal</AppText>
          <AppText variant="secondary" tone="secondary" numeric>
            P {formatQuantity(Math.round(n.protein * f * 10) / 10)} g · C {formatQuantity(Math.round(n.carbs * f * 10) / 10)} g · F {formatQuantity(Math.round(n.fat * f * 10) / 10)} g
          </AppText>
        </View>
        <TextButton label="View nutrition" onPress={() => { Keyboard.dismiss(); setShowNutrition(true); }} />
        <View style={{ gap: t.space.sm }}>
          <AppText variant="label" tone="secondary">Meal</AppText>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space.sm }}>
            {meals.map((m) => <FilterChip key={m} label={m === 'Snack' ? 'Snacks' : m} selected={m === d.meal} onPress={() => onDraft({ ...d, meal: m })} />)}
          </View>
        </View>
        </>}
      </ScrollView>
    </BottomSheet>
  );
}
