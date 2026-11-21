import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useCookable, usePantry, usePantryMutations } from '@/api/hooks';
import { Button, Card, Chip, Empty, Field, Loading } from '@/components/ui';
import { addDays, today } from '@/lib/format';
import { colors, font, spacing } from '@/lib/theme';

/** What you have at home, and what you can make with it. */
export default function PantryScreen() {
  const pantry = usePantry();
  const cookable = useCookable();
  const m = usePantryMutations();
  const [name, setName] = useState('');
  const [expires, setExpires] = useState<number | null>(null);

  const add = async () => {
    if (!name.trim()) return;
    await m.add.mutateAsync({ name: name.trim(), expiresOn: expires ? addDays(today(), expires) : undefined });
    setName('');
    setExpires(null);
  };

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Card style={{ gap: spacing.sm }}>
        <Field value={name} onChangeText={setName} placeholder="Add an item (e.g. chicken thighs)" onSubmitEditing={add} returnKeyType="done" />
        <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
          <Text style={font.small}>Use within:</Text>
          {[2, 4, 7].map((d) => <Chip key={d} label={`${d} days`} selected={expires === d} onPress={() => setExpires(expires === d ? null : d)} />)}
        </View>
        <Button title="Add to pantry" onPress={add} disabled={!name.trim()} loading={m.add.isPending} />
      </Card>

      <Text style={font.heading}>You can make</Text>
      {cookable.isLoading ? <Loading /> : (cookable.data ?? []).length === 0 ? <Empty title="No matches yet" hint="Add pantry items and import recipes." /> : null}
      {cookable.data?.map((c) => (
        <Pressable key={c.recipe.id} onPress={() => router.push({ pathname: '/recipe/[id]', params: { id: c.recipe.id } })}>
          <Card style={{ gap: 2 }}>
            <Text style={font.heading}>{c.recipe.name}</Text>
            <Text style={font.small}>
              {c.missing.length === 0 ? 'You have everything' : `Need: ${c.missing.join(', ')}`}
              {c.usesExpiringSoon ? '  ·  uses something expiring soon' : ''}
            </Text>
            <Text style={font.tiny}>{Math.round(c.recipe.perServing.calories)} kcal per serving · {c.matchPercent}% on hand</Text>
          </Card>
        </Pressable>
      ))}

      <Text style={font.heading}>In the pantry</Text>
      {pantry.data?.map((p) => (
        <View key={p.id} style={styles.item}>
          <View style={{ flex: 1 }}>
            <Text style={font.body}>{p.name}</Text>
            {p.expiresOn ? <Text style={[font.tiny, p.expiresOn <= addDays(today(), 2) && { color: colors.high }]}>use by {p.expiresOn}</Text> : null}
          </View>
          <Button title="Remove" variant="ghost" compact onPress={() => Alert.alert('Remove?', p.name, [{ text: 'Cancel', style: 'cancel' }, { text: 'Remove', onPress: () => m.remove.mutate(p.id) }])} />
        </View>
      ))}
      {pantry.data?.length === 0 ? <Empty title="Pantry is empty" /> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  item: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, paddingVertical: spacing.xs },
});
