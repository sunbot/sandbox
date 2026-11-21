import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTargets, useUpdateTargets } from '@/api/hooks';
import type { Targets } from '@/api/types';
import { Button, Card, Chip, ErrorView, Field, Loading } from '@/components/ui';
import { font, spacing } from '@/lib/theme';
import { useSnackbar } from '@/components/ds';

/** Daily calories and macros, weekly vs daily budgeting, and micronutrient targets. */
export default function TargetsScreen() {
  const targets = useTargets();
  if (targets.isLoading) return <Loading />;
  if (targets.error) return <ErrorView error={targets.error} />;
  // Keyed so the form re-initialises if the saved targets change underneath it.
  return <TargetsForm key={JSON.stringify(targets.data)} t={targets.data!} />;
}

function TargetsForm({ t }: { t: Targets }) {
  const snackbar = useSnackbar(); // alerts don't show on web; the snackbar works everywhere
  const update = useUpdateTargets();
  const [form, setForm] = useState({ calories: String(t.calories), protein: String(t.proteinGrams), carbs: String(t.carbGrams), fat: String(t.fatGrams) });
  const [mode, setMode] = useState<'Daily' | 'Weekly'>(t.budgetMode);
  const [micro, setMicro] = useState<Record<number, string>>({});
  const macroKcal = Number(form.protein) * 4 + Number(form.carbs) * 4 + Number(form.fat) * 9;

  const save = async () => {
    const overrides: Record<number, number | null> = {};
    for (const [id, v] of Object.entries(micro)) overrides[Number(id)] = v.trim() === '' ? null : Number(v);
    try {
      await update.mutateAsync({
        calories: Number(form.calories), proteinGrams: Number(form.protein), carbGrams: Number(form.carbs), fatGrams: Number(form.fat),
        budgetMode: mode, nutrientOverrides: overrides,
      });
      setMicro({});
      snackbar({ message: 'Targets saved' });
    } catch (e) {
      snackbar({ message: e instanceof Error ? e.message : 'Could not save' });
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Card style={{ gap: spacing.md }}>
        <Field label="Calories per day" value={form.calories} onChangeText={(v) => setForm({ ...form, calories: v })} keyboardType="number-pad" />
        <View style={styles.three}>
          <View style={{ flex: 1 }}><Field label="Protein g" value={form.protein} onChangeText={(v) => setForm({ ...form, protein: v })} keyboardType="number-pad" /></View>
          <View style={{ flex: 1 }}><Field label="Carbs g" value={form.carbs} onChangeText={(v) => setForm({ ...form, carbs: v })} keyboardType="number-pad" /></View>
          <View style={{ flex: 1 }}><Field label="Fat g" value={form.fat} onChangeText={(v) => setForm({ ...form, fat: v })} keyboardType="number-pad" /></View>
        </View>
        <Text style={font.tiny}>Macros add up to {Math.round(macroKcal)} kcal{Math.abs(macroKcal - Number(form.calories)) > 50 ? ' — not matching your calorie target' : ''}.</Text>
      </Card>

      <Card style={{ gap: spacing.sm }}>
        <Text style={font.heading}>If I go over or under</Text>
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <Chip label="Each day stands alone" selected={mode === 'Daily'} onPress={() => setMode('Daily')} />
          <Chip label="Balance over the week" selected={mode === 'Weekly'} onPress={() => setMode('Weekly')} />
        </View>
        <Text style={font.tiny}>Weekly: extra calories today lower the rest of the week a little (max ±{Math.round(t.maxDailyAdjustment * 100)}% per day), and vice versa.</Text>
      </Card>

      <Card style={{ gap: spacing.sm }}>
        <Text style={font.heading}>Nutrient targets</Text>
        <Text style={font.tiny}>Defaults are FDA Daily Values. Change any to match your needs (leave blank to reset).</Text>
        {t.nutrients.filter((n) => n.target != null && n.nutrientId !== 1008 && ![1003, 1004, 1005].includes(n.nutrientId)).map((n) => (
          <View key={n.nutrientId} style={styles.microRow}>
            <Text style={[font.body, { flex: 1 }]}>{n.name}{n.kind === 'Limit' ? ' (limit)' : ''}</Text>
            <View style={{ width: 110 }}>
              <Field value={micro[n.nutrientId] ?? String(n.target)} onChangeText={(v) => setMicro({ ...micro, [n.nutrientId]: v })} keyboardType="decimal-pad" />
            </View>
            <Text style={[font.small, { width: 28 }]}>{n.unit}</Text>
          </View>
        ))}
      </Card>

      <Button title="Save targets" onPress={save} loading={update.isPending} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  three: { flexDirection: 'row', gap: spacing.sm },
  microRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
