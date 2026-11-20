import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useLogQuick } from '@/api/hooks';
import { Button, Field } from '@/components/ui';
import { mealForNow, type Meal, today } from '@/lib/format';
import { font, spacing } from '@/lib/theme';

/** For restaurant meals or anything without data: just the numbers you know. */
export default function QuickAdd() {
  const params = useLocalSearchParams<{ date?: string; meal?: Meal }>();
  const [name, setName] = useState('');
  const [kcal, setKcal] = useState('');
  const [p, setP] = useState('');
  const [c, setC] = useState('');
  const [f, setF] = useState('');
  const log = useLogQuick();
  const num = (s: string) => (s.trim() === '' ? undefined : Number(s.replace(',', '.')));

  const save = async () => {
    const calories = num(kcal);
    if (!calories || calories <= 0) return Alert.alert('Enter calories');
    await log.mutateAsync({ date: params.date ?? today(), meal: params.meal ?? mealForNow(), name: name || 'Quick entry', calories, protein: num(p), carbs: num(c), fat: num(f) });
    router.back();
  };

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Text style={font.small}>Use this when you only know the totals (e.g. a restaurant menu). Micronutrients won’t be tracked for it.</Text>
      <Field label="What was it?" value={name} onChangeText={setName} placeholder="Burrito bowl" />
      <Field label="Calories" value={kcal} onChangeText={setKcal} keyboardType="decimal-pad" />
      <Field label="Protein (g, optional)" value={p} onChangeText={setP} keyboardType="decimal-pad" />
      <Field label="Carbs (g, optional)" value={c} onChangeText={setC} keyboardType="decimal-pad" />
      <Field label="Fat (g, optional)" value={f} onChangeText={setF} keyboardType="decimal-pad" />
      <Button title="Log it" onPress={save} loading={log.isPending} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({ page: { padding: spacing.lg, gap: spacing.md } });
