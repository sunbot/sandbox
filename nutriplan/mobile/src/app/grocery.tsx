import { Pressable, ScrollView, Share, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useGrocery } from '@/api/hooks';
import { AppCard, AppText, EmptyState, PrimaryButton, SecondaryButton, Skeleton, TextButton } from '@/components/ds';
import { CloudOff, ShoppingBasket, Square, SquareCheck } from '@/components/ds/icons';
import { addDays, shortDay, today } from '@/lib/format';
import { usePersistedState } from '@/lib/persisted';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * Everything the remaining plan needs, merged, minus the pantry, grouped by aisle. Tap to check off — checks are
 * kept on this device until you clear them, so leaving the screen mid-shop doesn't lose your place.
 */
export default function GroceryScreen() {
  const t = useTheme();
  const params = useLocalSearchParams<{ from?: string; to?: string }>();
  const from = params.from ?? today();
  const to = params.to ?? addDays(from, 6);
  const list = useGrocery(from, to);
  const [checked, setChecked] = usePersistedState<Record<string, boolean>>(`grocery.checked.${from}.${to}`, {});
  const page = { padding: t.screenPadding, gap: t.space.lg, paddingBottom: t.space.huge };

  if (list.isLoading) {
    return <ScrollView style={{ flex: 1, backgroundColor: t.colors.background }} contentContainerStyle={page}>{[0, 1, 2].map((i) => <Skeleton key={i} width="100%" height={120} radius={20} />)}</ScrollView>;
  }
  if (list.error || !list.data) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: t.colors.background }} contentContainerStyle={page}>
        <EmptyState icon={CloudOff} title="Couldn't load the list" body={list.error instanceof Error ? list.error.message : undefined}
          action={<PrimaryButton label="Try again" onPress={() => list.refetch()} />} />
      </ScrollView>
    );
  }
  const g = list.data;
  const all = g.aisles.flatMap((a) => a.items.filter((i) => !i.inPantry).map((i) => `${a.aisle}:${i.name}`));
  const done = all.filter((k) => checked[k]).length;

  const share = () => {
    const text = g.aisles
      .map((a) => `${a.aisle}\n${a.items.filter((i) => !i.inPantry && !checked[`${a.aisle}:${i.name}`]).map((i) => `☐ ${i.name} — ${i.display}`).join('\n')}`)
      .filter((s) => s.includes('☐'))
      .join('\n\n');
    Share.share({ message: text });
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.colors.background }} contentContainerStyle={page}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm }}>
        <View style={{ flex: 1 }}>
          <AppText variant="cardTitle" numeric>{done} of {all.length} in the cart</AppText>
          <AppText variant="secondary" tone="secondary">{shortDay(from)} – {shortDay(to)} · from your plan, minus the pantry</AppText>
        </View>
        <SecondaryButton label="Share" onPress={share} />
      </View>
      {done > 0 ? <View style={{ flexDirection: 'row' }}><TextButton label="Clear checks" tone="secondary" onPress={() => setChecked(() => ({}))} /></View> : null}

      {g.aisles.length === 0 ? <EmptyState icon={ShoppingBasket} title="Nothing planned yet" body="Plan meals on the Week tab and their ingredients show up here." /> : null}
      {g.aisles.map((a) => (
        <AppCard key={a.aisle} padded={false}>
          <AppText variant="overline" tone="muted" style={{ paddingHorizontal: t.space.lg, paddingTop: t.space.md, paddingBottom: t.space.xs }}>{a.aisle.toUpperCase()}</AppText>
          {a.items.map((i) => {
            const key = `${a.aisle}:${i.name}`;
            const isDone = !!checked[key] || i.inPantry;
            return (
              <Pressable key={key} disabled={i.inPantry} onPress={() => setChecked((c) => ({ ...c, [key]: !c[key] }))}
                accessibilityRole="checkbox" accessibilityState={{ checked: isDone, disabled: i.inPantry }} aria-checked={isDone} accessibilityLabel={`${i.name}, ${i.inPantry ? 'in your pantry' : i.display}`}
                style={({ pressed }) => [{ flexDirection: 'row', gap: t.space.md, alignItems: 'center', minHeight: 56, paddingHorizontal: t.space.lg, paddingVertical: t.space.sm, borderTopWidth: 1, borderTopColor: t.colors.border }, pressed && { backgroundColor: t.colors.surfaceMuted }]}>
                {isDone ? <SquareCheck size={22} strokeWidth={1.8} color={t.colors.primary} /> : <Square size={22} strokeWidth={1.8} color={t.colors.textMuted} />}
                <View style={{ flex: 1, gap: 2 }}>
                  <AppText variant="body" tone={isDone ? 'muted' : 'default'} style={isDone ? { textDecorationLine: 'line-through' } : undefined}>{i.name}</AppText>
                  <AppText variant="caption" tone="muted" numberOfLines={2}>
                    {i.inPantry ? 'In your pantry' : i.display}{i.unconvertedAmounts.length ? ` · also ${i.unconvertedAmounts.join(', ')}` : ''} · {i.usedIn.join(', ')}
                  </AppText>
                </View>
              </Pressable>
            );
          })}
        </AppCard>
      ))}
    </ScrollView>
  );
}
