import { useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { useTargets, useUpdateTargets } from '@/api/hooks';
import type { Targets } from '@/api/types';
import { AppCard, AppText, EmptyState, FilterChip, PrimaryButton, Skeleton, useSnackbar } from '@/components/ds';
import { CloudOff, Star } from '@/components/ds/icons';
import { useTheme } from '@/theme/ThemeProvider';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const ADJUST = [0.1, 0.15, 0.2, 0.25];
const MACRO_IDS = [1008, 1003, 1004, 1005];

/** Daily calories and macros, how the week balances, and micronutrient targets with the ones you focus on. */
export default function TargetsScreen() {
  const t = useTheme();
  const targets = useTargets();
  if (targets.isLoading) return <ScrollView style={{ flex: 1, backgroundColor: t.colors.background }} contentContainerStyle={{ padding: t.screenPadding, gap: t.space.lg }}>{[0, 1, 2].map((i) => <Skeleton key={i} width="100%" height={140} radius={20} />)}</ScrollView>;
  if (targets.error || !targets.data) {
    return <ScrollView style={{ flex: 1, backgroundColor: t.colors.background }} contentContainerStyle={{ padding: t.screenPadding }}>
      <EmptyState icon={CloudOff} title="Couldn't load targets" body={targets.error instanceof Error ? targets.error.message : undefined} action={<PrimaryButton label="Try again" onPress={() => targets.refetch()} />} />
    </ScrollView>;
  }
  // Keyed so the form re-initialises if the saved targets change underneath it.
  return <TargetsForm key={JSON.stringify(targets.data)} t={targets.data} />;
}

function NumberInput({ label, value, onChange, unit, width }: { label: string; value: string; onChange: (v: string) => void; unit?: string; width?: number }) {
  const t = useTheme();
  return (
    <View style={{ gap: 4, flex: width ? undefined : 1, width, minWidth: 0 }}>
      {label ? <AppText variant="label" tone="secondary">{label}</AppText> : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 48, borderRadius: t.radii.button, borderWidth: 1, borderColor: t.colors.border, backgroundColor: t.colors.surfaceMuted, paddingHorizontal: t.space.md }}>
        <TextInput value={value} onChangeText={onChange} keyboardType="decimal-pad" accessibilityLabel={label || unit}
          style={[t.type.body, { flex: 1, minWidth: 0, color: t.colors.text }]} />
        {unit ? <AppText variant="secondary" tone="muted">{unit}</AppText> : null}
      </View>
    </View>
  );
}

function TargetsForm({ t: targets }: { t: Targets }) {
  const t = useTheme();
  const snackbar = useSnackbar(); // alerts don't show on web; the snackbar works everywhere
  const update = useUpdateTargets();
  const [form, setForm] = useState({ calories: String(targets.calories), protein: String(targets.proteinGrams), carbs: String(targets.carbGrams), fat: String(targets.fatGrams) });
  const [mode, setMode] = useState<'Daily' | 'Weekly'>(targets.budgetMode);
  const [weekStart, setWeekStart] = useState(targets.weekStartsOn);
  const [adjust, setAdjust] = useState(targets.maxDailyAdjustment);
  const [micro, setMicro] = useState<Record<number, string>>({});
  const [focus, setFocus] = useState<Set<number>>(() => new Set(targets.nutrients.filter((n) => n.isFocus).map((n) => n.nutrientId)));
  const macroKcal = Number(form.protein) * 4 + Number(form.carbs) * 4 + Number(form.fat) * 9;
  const mismatch = Math.abs(macroKcal - Number(form.calories)) > 50;

  const save = async () => {
    const overrides: Record<number, number | null> = {};
    for (const [id, v] of Object.entries(micro)) overrides[Number(id)] = v.trim() === '' ? null : Number(v);
    try {
      await update.mutateAsync({
        calories: Number(form.calories), proteinGrams: Number(form.protein), carbGrams: Number(form.carbs), fatGrams: Number(form.fat),
        budgetMode: mode, weekStartsOn: weekStart, maxDailyAdjustment: adjust, nutrientOverrides: overrides, focusNutrients: [...focus],
      });
      setMicro({});
      snackbar({ message: 'Targets saved' });
    } catch (e) {
      snackbar({ message: e instanceof Error ? e.message : 'Could not save' });
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.colors.background }} contentContainerStyle={{ padding: t.screenPadding, gap: t.space.lg, paddingBottom: t.space.huge }} keyboardShouldPersistTaps="handled">
      <AppCard style={{ gap: t.space.md }}>
        <AppText variant="cardTitle">Daily calories and macros</AppText>
        <NumberInput label="Calories per day" value={form.calories} onChange={(v) => setForm({ ...form, calories: v })} unit="kcal" />
        <View style={{ flexDirection: 'row', gap: t.space.sm }}>
          <NumberInput label="Protein" value={form.protein} onChange={(v) => setForm({ ...form, protein: v })} unit="g" />
          <NumberInput label="Carbs" value={form.carbs} onChange={(v) => setForm({ ...form, carbs: v })} unit="g" />
          <NumberInput label="Fat" value={form.fat} onChange={(v) => setForm({ ...form, fat: v })} unit="g" />
        </View>
        <AppText variant="secondary" tone={mismatch ? 'warning' : 'muted'} numeric>
          Macros add up to {Math.round(macroKcal)} kcal{mismatch ? ' — not matching your calorie target' : ''}.
        </AppText>
      </AppCard>

      <AppCard style={{ gap: t.space.md }}>
        <AppText variant="cardTitle">Your week</AppText>
        <View style={{ gap: t.space.xs }}>
          <AppText variant="label" tone="secondary">If I go over or under</AppText>
          <View style={{ flexDirection: 'row', gap: t.space.sm, flexWrap: 'wrap' }}>
            <FilterChip label="Each day stands alone" selected={mode === 'Daily'} onPress={() => setMode('Daily')} />
            <FilterChip label="Balance over the week" selected={mode === 'Weekly'} onPress={() => setMode('Weekly')} />
          </View>
        </View>
        {mode === 'Weekly' ? (
          <View style={{ gap: t.space.xs }}>
            <AppText variant="label" tone="secondary">Most a day can move</AppText>
            <View style={{ flexDirection: 'row', gap: t.space.sm, flexWrap: 'wrap' }}>
              {ADJUST.map((a) => <FilterChip key={a} label={`±${Math.round(a * 100)}%`} selected={Math.abs(adjust - a) < 0.001} onPress={() => setAdjust(a)} />)}
            </View>
            <AppText variant="caption" tone="muted">Extra calories today lower the rest of the week a little (and the other way round), never more than this per day.</AppText>
          </View>
        ) : null}
        <View style={{ gap: t.space.xs }}>
          <AppText variant="label" tone="secondary">Week starts on</AppText>
          <View style={{ flexDirection: 'row', gap: t.space.sm, flexWrap: 'wrap' }}>
            {DAYS.map((d) => <FilterChip key={d} label={d.slice(0, 3)} selected={weekStart === d} onPress={() => setWeekStart(d)} accessibilityLabel={d} />)}
          </View>
        </View>
      </AppCard>

      <AppCard style={{ gap: t.space.sm }}>
        <AppText variant="cardTitle">Nutrient targets</AppText>
        <AppText variant="secondary" tone="muted">Defaults are FDA Daily Values. Change any to suit you (leave blank to reset). Star the ones you care most about — Fill gaps favours them.</AppText>
        {targets.nutrients.filter((n) => n.target != null && !MACRO_IDS.includes(n.nutrientId)).map((n) => {
          const isFocus = focus.has(n.nutrientId);
          return (
            <View key={n.nutrientId} style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm, minHeight: 52 }}>
              <Pressable onPress={() => setFocus((s) => { const x = new Set(s); if (x.has(n.nutrientId)) x.delete(n.nutrientId); else x.add(n.nutrientId); return x; })}
                accessibilityRole="checkbox" accessibilityState={{ checked: isFocus }} aria-checked={isFocus} accessibilityLabel={`Focus on ${n.name}`} hitSlop={8}
                style={{ width: 40, height: 48, alignItems: 'center', justifyContent: 'center' }}>
                <Star size={20} strokeWidth={1.8} color={isFocus ? t.colors.accent : t.colors.textMuted} fill={isFocus ? t.colors.accent : 'none'} />
              </Pressable>
              <AppText variant="body" style={{ flex: 1 }} numberOfLines={2}>{n.name}{n.kind === 'Limit' ? <AppText variant="secondary" tone="muted"> · limit</AppText> : null}</AppText>
              <NumberInput label="" value={micro[n.nutrientId] ?? String(n.target)} onChange={(v) => setMicro({ ...micro, [n.nutrientId]: v })} unit={n.unit} width={120} />
            </View>
          );
        })}
      </AppCard>

      <PrimaryButton label="Save targets" onPress={save} loading={update.isPending} fullWidth />
    </ScrollView>
  );
}
