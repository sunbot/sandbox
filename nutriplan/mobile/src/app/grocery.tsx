import { useState } from 'react';
import { Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useGrocery } from '@/api/hooks';
import { Button, Card, Empty, ErrorView, Loading } from '@/components/ui';
import { addDays, today } from '@/lib/format';
import { colors, font, spacing } from '@/lib/theme';

/** Everything the remaining plan needs, merged, minus the pantry, grouped by aisle. Tap to check off. */
export default function GroceryScreen() {
  const params = useLocalSearchParams<{ from?: string; to?: string }>();
  const from = params.from ?? today();
  const to = params.to ?? addDays(from, 6);
  const list = useGrocery(from, to);
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  if (list.isLoading) return <Loading />;
  if (list.error) return <ErrorView error={list.error} onRetry={() => list.refetch()} />;
  const g = list.data!;

  const share = () => {
    const text = g.aisles
      .map((a) => `${a.aisle}\n${a.items.filter((i) => !i.inPantry).map((i) => `☐ ${i.name} — ${i.display}`).join('\n')}`)
      .filter((s) => s.includes('☐'))
      .join('\n\n');
    Share.share({ message: text });
  };

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={font.small}>{g.itemCount} items · {from} → {to}</Text>
        <Button title="Share" variant="secondary" compact onPress={share} />
      </View>
      {g.aisles.length === 0 ? <Empty title="Nothing planned yet" hint="Plan meals on the Week tab and they'll show up here." /> : null}
      {g.aisles.map((a) => (
        <Card key={a.aisle}>
          <Text style={[font.heading, { marginBottom: spacing.xs }]}>{a.aisle}</Text>
          {a.items.map((i) => {
            const key = `${a.aisle}:${i.name}`;
            const done = checked[key] || i.inPantry;
            return (
              <Pressable key={key} onPress={() => setChecked((c) => ({ ...c, [key]: !c[key] }))} style={styles.row}>
                <Text style={styles.box}>{done ? '☑' : '☐'}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[font.body, done && styles.done]}>{i.name}</Text>
                  <Text style={font.tiny}>{i.inPantry ? 'In your pantry' : i.display}{i.unconvertedAmounts.length ? ` · also ${i.unconvertedAmounts.join(', ')}` : ''}  ·  {i.usedIn.join(', ')}</Text>
                </View>
              </Pressable>
            );
          })}
        </Card>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  row: { flexDirection: 'row', gap: spacing.md, paddingVertical: spacing.sm, alignItems: 'center' },
  box: { fontSize: 20, color: colors.primary },
  done: { textDecorationLine: 'line-through', color: colors.textMuted },
});
