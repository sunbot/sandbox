import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useFoodSearch } from '@/api/hooks';
import { Button, Empty, Field, Loading, QualityBadge } from '@/components/ui';
import { VoiceButton } from '@/components/VoiceButton';
import { ScanBarcode } from '@/components/ds/icons';
import { colors, font, spacing } from '@/lib/theme';

/** Type or speak a food; results are USDA/your foods ranked by match, trust and how often you eat them. */
export default function FoodSearch() {
  const params = useLocalSearchParams<{ date: string; meal: string; mode: string }>();
  const [text, setText] = useState('');
  const search = useFoodSearch(text);

  return (
    <View style={styles.page}>
      <View style={styles.searchRow}>
        <View style={{ flex: 1 }}>
          <Field value={text} onChangeText={setText} placeholder="Search foods (e.g. greek yogurt)" autoFocus returnKeyType="search" />
        </View>
        <VoiceButton onText={setText} onFinal={setText} />
      </View>
      <View style={styles.actions}>
        <Button title="Scan barcode" icon={ScanBarcode} variant="secondary" compact onPress={() => router.replace({ pathname: '/scan', params })} />
        <Button title="From label" variant="secondary" compact onPress={() => router.push({ pathname: '/custom-food', params })} />
      </View>

      {search.isFetching && !search.data ? <Loading /> : (
        <FlatList
          data={search.data ?? []}
          keyExtractor={(f) => f.id}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={text.length >= 2 && !search.isFetching ? <Empty title="No matches" hint="Try fewer words, or add it from the label." /> : undefined}
          renderItem={({ item: f }) => (
            <Pressable style={styles.result} onPress={() => router.push({ pathname: '/food/[id]', params: { ...params, id: f.id } })}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={font.body} numberOfLines={2}>{f.name}{f.brand ? ` · ${f.brand}` : ''}</Text>
                <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
                  <QualityBadge quality={f.quality} source={f.source} />
                  <Text style={font.small}>P {Math.round(f.per100g.protein)} · C {Math.round(f.per100g.carbs)} · F {Math.round(f.per100g.fat)} per 100 g</Text>
                </View>
              </View>
              <Text style={[font.body, font.number, { fontWeight: '600' }]}>{Math.round(f.per100g.calories)}</Text>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: spacing.lg, gap: spacing.md },
  searchRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  actions: { flexDirection: 'row', gap: spacing.sm },
  result: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
});
