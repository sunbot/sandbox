import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useCreateFood } from '@/api/hooks';
import { Button, Field } from '@/components/ui';
import { font, spacing } from '@/lib/theme';

/**
 * Add a packaged food from its Nutrition Facts label. Values are per serving as printed;
 * the server converts to per-100 g and flags the entry if calories don't match the macros.
 */
const fields: { id: number; label: string }[] = [
  { id: 1008, label: 'Calories' },
  { id: 1004, label: 'Total fat (g)' },
  { id: 1258, label: 'Saturated fat (g)' },
  { id: 1257, label: 'Trans fat (g)' },
  { id: 1253, label: 'Cholesterol (mg)' },
  { id: 1093, label: 'Sodium (mg)' },
  { id: 1005, label: 'Total carbohydrate (g)' },
  { id: 1079, label: 'Dietary fiber (g)' },
  { id: 2000, label: 'Total sugars (g)' },
  { id: 1235, label: 'Added sugars (g)' },
  { id: 1003, label: 'Protein (g)' },
  { id: 1114, label: 'Vitamin D (µg)' },
  { id: 1087, label: 'Calcium (mg)' },
  { id: 1089, label: 'Iron (mg)' },
  { id: 1092, label: 'Potassium (mg)' },
];

export default function CustomFood() {
  const params = useLocalSearchParams<{ barcode?: string; date?: string; meal?: string; mode?: string }>();
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [serving, setServing] = useState('');
  const [servingText, setServingText] = useState('');
  const [values, setValues] = useState<Record<number, string>>({});
  const create = useCreateFood();

  const save = async () => {
    const grams = Number(serving.replace(',', '.'));
    if (!name.trim() || !grams) return Alert.alert('Name and serving size (g) are required');
    const nutrients: Record<number, number> = {};
    for (const [id, v] of Object.entries(values)) if (v.trim() !== '') nutrients[Number(id)] = Number(v.replace(',', '.'));
    if (nutrients[1008] === undefined) return Alert.alert('Calories are required');
    try {
      const food = await create.mutateAsync({ name, brand: brand || undefined, barcode: params.barcode, servingGrams: grams, servingDescription: servingText || undefined, nutrientsPerServing: nutrients });
      router.replace({ pathname: '/food/[id]', params: { ...params, id: food.id } });
    } catch (e) {
      Alert.alert('Could not save', e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      {params.barcode ? <Text style={font.small}>Barcode {params.barcode} wasn’t found. Enter the label once and it’ll scan instantly next time.</Text> : null}
      <Field label="Name" value={name} onChangeText={setName} />
      <Field label="Brand" value={brand} onChangeText={setBrand} />
      <Field label="Serving size (g)" value={serving} onChangeText={setServing} keyboardType="decimal-pad" />
      <Field label="Serving description (e.g. 2/3 cup)" value={servingText} onChangeText={setServingText} />
      <Text style={[font.heading, { marginTop: spacing.md }]}>Per serving</Text>
      {fields.map((f) => (
        <Field key={f.id} label={f.label} value={values[f.id] ?? ''} keyboardType="decimal-pad"
          onChangeText={(t) => setValues((v) => ({ ...v, [f.id]: t }))} />
      ))}
      <Button title="Save food" onPress={save} loading={create.isPending} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({ page: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl } });
