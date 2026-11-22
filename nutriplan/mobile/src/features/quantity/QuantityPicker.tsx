import { useState } from 'react';
import { Platform, Pressable, TextInput, View } from 'react-native';
import type { Measure } from '@/api/types';
import { AppText } from '@/components/ds';
import { Check, ChevronDown, ChevronUp } from '@/components/ds/icons';
import { useTheme } from '@/theme/ThemeProvider';
import { convert, formatQuantity, matchMeasure, parseQuantity, volumeNote } from './quantity';

export type QuantityValue = { text: string; unit: string };

/**
 * Amount + measure, typed directly: "12 almonds", "0.5 cup", "1 1/2 tbsp". The measures are the ones the server says
 * this food really supports; changing measure keeps the same physical amount. Shared by logging, editing, planning
 * and Ask so conversions live in one place.
 */
export function QuantityPicker({ measures, value, onChange, baseUnit = 'g', error, autoFocus, onSubmit }: {
  measures: Measure[];
  value: QuantityValue;
  onChange: (v: QuantityValue) => void;
  baseUnit?: 'g' | 'ml';
  error?: string | null;
  autoFocus?: boolean;
  onSubmit?: () => void;
}) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const measure = matchMeasure(measures, value.unit) ?? measures[0];
  const qty = parseQuantity(value.text);
  const equivalent = measure && qty !== null && qty > 0 && measure.base > 0 && measure.unit !== baseUnit
    ? `= ${formatQuantity(Math.round(qty * measure.base * 10) / 10)} ${baseUnit}` : null;
  const note = volumeNote(measures, baseUnit);

  const pick = (m: Measure) => {
    setOpen(false);
    if (!measure || m.unit === measure.unit) return;
    // Same physical amount in the new measure, when both are known; otherwise keep what was typed.
    const text = qty !== null && qty > 0 && measure.base > 0 && m.base > 0 ? formatQuantity(convert(qty, measure, m)) : value.text;
    onChange({ text, unit: m.unit });
  };

  const field = { minHeight: t.sizes.touch, borderRadius: t.radii.button, borderWidth: 1, borderColor: error ? t.colors.error : t.colors.border, backgroundColor: t.colors.surface };
  return (
    <View style={{ gap: t.space.sm }}>
      <View style={{ flexDirection: 'row', gap: t.space.sm, alignItems: 'stretch' }}>
        <TextInput
          value={value.text}
          onChangeText={(text) => onChange({ ...value, text })}
          keyboardType="decimal-pad"
          inputMode="decimal"
          selectTextOnFocus
          autoFocus={autoFocus}
          returnKeyType="done"
          onSubmitEditing={onSubmit}
          accessibilityLabel="Amount"
          accessibilityHint="Type a number, a decimal or a fraction like 1/2"
          placeholder="0"
          placeholderTextColor={t.colors.textMuted}
          style={[field, { width: 112, paddingHorizontal: t.space.md, color: t.colors.text, fontSize: t.type.sectionTitle.fontSize, fontVariant: ['tabular-nums'] },
            Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null]}
        />
        <Pressable onPress={() => setOpen((o) => !o)} accessibilityRole="button" accessibilityState={{ expanded: open }}
          accessibilityLabel={`Measure: ${measure ? measure.plural : 'none'}. Change measure`}
          style={({ pressed }) => [field, { flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: t.space.md, gap: t.space.sm }, pressed && { backgroundColor: t.colors.surfaceMuted }]}>
          <AppText variant="body" style={{ flex: 1 }} numberOfLines={1}>{measure ? (qty === 1 ? measure.label : measure.plural) : 'Choose'}</AppText>
          {open ? <ChevronUp size={20} color={t.colors.textSecondary} /> : <ChevronDown size={20} color={t.colors.textSecondary} />}
        </Pressable>
      </View>

      {equivalent && !open ? <AppText variant="secondary" tone="secondary" numeric>{equivalent}</AppText> : null}
      {error ? <AppText variant="secondary" style={{ color: t.colors.errorText }} accessibilityLiveRegion="polite">{error}</AppText> : null}

      {open ? (
        <View style={{ borderRadius: t.radii.button, borderWidth: 1, borderColor: t.colors.border, overflow: 'hidden' }} accessibilityRole="radiogroup">
          {measures.map((m, i) => {
            const selected = m.unit === measure?.unit;
            return (
              <Pressable key={m.unit} onPress={() => pick(m)} accessibilityRole="radio" accessibilityState={{ selected }}
                accessibilityLabel={`${m.label}${m.base > 0 && m.unit !== baseUnit ? `, ${formatQuantity(m.base)} ${baseUnit}` : ''}`}
                style={({ pressed }) => ({ minHeight: t.sizes.touch, flexDirection: 'row', alignItems: 'center', gap: t.space.sm, paddingHorizontal: t.space.md, paddingVertical: t.space.xs,
                  borderTopWidth: i === 0 ? 0 : 1, borderTopColor: t.colors.border, backgroundColor: pressed ? t.colors.surfaceMuted : selected ? t.colors.primaryLight : t.colors.surface })}>
                <View style={{ flex: 1, gap: 1 }}>
                  <AppText variant="body">{m.label}{m.base > 0 && m.unit !== baseUnit ? <AppText variant="secondary" tone="secondary" numeric>{`  ${formatQuantity(m.base)} ${baseUnit}`}</AppText> : null}</AppText>
                  {m.source ? <AppText variant="caption" tone="muted" numberOfLines={2}>USDA: {m.source}</AppText> : null}
                </View>
                {selected ? <Check size={18} color={t.colors.primary} /> : null}
              </Pressable>
            );
          })}
          {note ? <AppText variant="caption" tone="muted" style={{ padding: t.space.md, borderTopWidth: 1, borderTopColor: t.colors.border }}>{note}</AppText> : null}
        </View>
      ) : null}
    </View>
  );
}
