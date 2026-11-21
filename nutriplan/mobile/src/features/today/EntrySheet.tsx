import { useState } from 'react';
import { View } from 'react-native';
import { Minus, Plus, Trash2 } from '@/components/ds/icons';
import type { DiaryEntry } from '@/api/types';
import { AppText, BottomSheet, FilterChip, IconButton, PrimaryButton, SecondaryButton } from '@/components/ds';
import { amount as fmtQty, meals, type Meal } from '@/lib/format';
import { useTheme } from '@/theme/ThemeProvider';

export type EntryDraft = { quantity: number; meal: Meal };

/** Step size that feels natural for the unit: grams in 5/10 g, servings and household measures in quarters. */
export function stepFor(unit: string, quantity: number) {
  if (unit === 'g' || unit === 'ml') return quantity < 50 ? 5 : 10;
  return 0.25;
}

/**
 * Edit a logged food: amount and meal, or delete. Edits go through the existing PATCH (scale + meal),
 * so nutrition scales exactly as before. The draft is kept by the caller, so dismissing the sheet loses nothing.
 */
export function EntrySheet({ entry, draft, onDraft, onClose, onSave, onDelete, saving }: {
  entry: DiaryEntry | null;
  draft: EntryDraft | null;
  onDraft: (d: EntryDraft) => void;
  onClose: () => void;
  onSave: (entry: DiaryEntry, draft: EntryDraft) => void;
  onDelete: (entry: DiaryEntry) => void;
  saving?: boolean;
}) {
  const t = useTheme();
  const [lastEntry, setLastEntry] = useState(entry);
  if (entry && entry !== lastEntry) setLastEntry(entry);
  const e = entry ?? lastEntry; // keep content during the closing animation
  if (!e) return null;

  const d = draft ?? { quantity: e.item.quantity, meal: e.meal };
  const editableAmount = e.item.kind !== 'QuickCalories' && e.item.quantity > 0;
  const step = stepFor(e.item.unit, d.quantity);
  const scale = e.item.quantity > 0 ? d.quantity / e.item.quantity : 1;
  const kcal = e.item.nutrition.calories * scale;
  const changed = Math.abs(scale - 1) > 1e-9 || d.meal !== e.meal;

  return (
    <BottomSheet
      visible={!!entry}
      onClose={onClose}
      title={e.item.name}
      footer={<>
        <PrimaryButton label={changed ? 'Save changes' : 'Done'} onPress={() => (changed ? onSave(e, d) : onClose())} loading={saving} fullWidth />
        <SecondaryButton label="Delete" icon={Trash2} tone="danger" onPress={() => onDelete(e)} fullWidth />
      </>}
    >
      <View style={{ gap: t.space.lg }}>
        {editableAmount ? (
          <View style={{ gap: t.space.sm }}>
            <AppText variant="label" tone="secondary">Amount</AppText>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.md }}>
              <IconButton icon={Minus} label="Less" variant="outline" disabled={d.quantity - step <= 0}
                onPress={() => onDraft({ ...d, quantity: Math.round((d.quantity - step) * 100) / 100 })} />
              <View style={{ flex: 1, alignItems: 'center' }}>
                <AppText variant="sectionTitle" numeric>{fmtQty(d.quantity, e.item.unit)}</AppText>
                <AppText variant="secondary" tone="secondary" numeric>{Math.round(kcal)} kcal</AppText>
              </View>
              <IconButton icon={Plus} label="More" variant="outline"
                onPress={() => onDraft({ ...d, quantity: Math.round((d.quantity + step) * 100) / 100 })} />
            </View>
          </View>
        ) : (
          <AppText variant="secondary" tone="secondary" numeric>{Math.round(kcal)} kcal · quick entry</AppText>
        )}
        <View style={{ gap: t.space.sm }}>
          <AppText variant="label" tone="secondary">Meal</AppText>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space.sm }}>
            {meals.map((m) => <FilterChip key={m} label={m === 'Snack' ? 'Snacks' : m} selected={m === d.meal} onPress={() => onDraft({ ...d, meal: m })} />)}
          </View>
        </View>
      </View>
    </BottomSheet>
  );
}
