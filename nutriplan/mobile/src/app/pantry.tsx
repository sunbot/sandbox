import { useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useCookable, usePantry, usePantryMutations } from '@/api/hooks';
import type { PantryItem } from '@/api/types';
import { AppCard, AppText, Badge, BottomSheet, EmptyState, FilterChip, PrimaryButton, SecondaryButton, Skeleton, useSnackbar } from '@/components/ds';
import { Check, ChefHat, ChevronRight, Package, Trash2 } from '@/components/ds/icons';
import { addDays, today } from '@/lib/format';
import { useTheme } from '@/theme/ThemeProvider';

const USE_WITHIN = [2, 4, 7, 14];

/** What you have at home, and what you can make with it. Tap an item to change its amount, use-by date or staple flag. */
export default function PantryScreen() {
  const t = useTheme();
  const snackbar = useSnackbar(); // alerts don't show on web; the snackbar works everywhere
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set()); // removals waiting for their Undo window
  const pantry = usePantry();
  const cookable = useCookable();
  const m = usePantryMutations();
  const [name, setName] = useState('');
  const [grams, setGrams] = useState('');
  const [expires, setExpires] = useState<number | null>(null);
  const [staple, setStaple] = useState(false);
  const [editing, setEditing] = useState<PantryItem | null>(null);
  const unhide = (id: string) => setHidden((s) => { const n = new Set(s); n.delete(id); return n; });

  const add = async () => {
    if (!name.trim()) return;
    try {
      await m.add.mutateAsync({ name: name.trim(), grams: Number(grams) > 0 ? Number(grams) : undefined, expiresOn: expires ? addDays(today(), expires) : undefined, isStaple: staple });
      setName(''); setGrams(''); setExpires(null); setStaple(false);
    } catch (e) { snackbar({ message: e instanceof Error ? e.message : "Couldn't add it" }); }
  };

  const remove = (p: PantryItem) => {
    setEditing(null);
    setHidden((s) => new Set(s).add(p.id));
    snackbar({ message: `Removed ${p.name}`, actionLabel: 'Undo', onAction: () => unhide(p.id),
      onTimeout: () => m.remove.mutate(p.id, { onError: (e) => { unhide(p.id); snackbar({ message: e instanceof Error ? e.message : "Couldn't remove it" }); } }) });
  };

  const items = (pantry.data ?? []).filter((p) => !hidden.has(p.id)).sort((a, b) => (a.expiresOn ?? '9999').localeCompare(b.expiresOn ?? '9999'));

  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.colors.background }} contentContainerStyle={{ padding: t.screenPadding, gap: t.space.lg, paddingBottom: t.space.huge }} keyboardShouldPersistTaps="handled">
      <AppCard style={{ gap: t.space.md }}>
        <AppText variant="cardTitle">Add to pantry</AppText>
        <Input value={name} onChangeText={setName} placeholder="Item, e.g. chicken thighs" onSubmitEditing={add} />
        <Input value={grams} onChangeText={setGrams} placeholder="Amount in grams (optional)" keyboardType="decimal-pad" />
        <View style={{ gap: t.space.xs }}>
          <AppText variant="label" tone="secondary">Use within</AppText>
          <View style={{ flexDirection: 'row', gap: t.space.sm, flexWrap: 'wrap' }}>
            {USE_WITHIN.map((d) => <FilterChip key={d} label={`${d} days`} selected={expires === d} onPress={() => setExpires(expires === d ? null : d)} />)}
            <FilterChip label="Staple" selected={staple} onPress={() => setStaple(!staple)} accessibilityLabel="Staple: always on hand" />
          </View>
        </View>
        <PrimaryButton label="Add" onPress={add} disabled={!name.trim()} loading={m.add.isPending} fullWidth />
      </AppCard>

      <View style={{ gap: t.space.sm }}>
        <AppText variant="sectionTitle" accessibilityRole="header">You can make</AppText>
        {cookable.isLoading ? <Skeleton width="100%" height={72} radius={20} /> : (cookable.data ?? []).length === 0
          ? <EmptyState icon={ChefHat} title="No matches yet" body="Add pantry items and import recipes to see what you can cook." /> : null}
        {cookable.data?.map((c) => (
          <Pressable key={c.recipe.id} onPress={() => router.push({ pathname: '/recipe/[id]', params: { id: c.recipe.id } })} accessibilityRole="button">
            <AppCard style={{ gap: 2 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm }}>
                <AppText variant="cardTitle" style={{ flex: 1 }}>{c.recipe.name}</AppText>
                <ChevronRight size={18} color={t.colors.textMuted} />
              </View>
              <AppText variant="secondary" tone="secondary">
                {c.missing.length === 0 ? 'You have everything' : `Need: ${c.missing.join(', ')}`}{c.usesExpiringSoon ? ' · uses something expiring soon' : ''}
              </AppText>
              <AppText variant="caption" tone="muted" numeric>{Math.round(c.recipe.perServing.calories)} kcal per serving · {c.matchPercent}% on hand</AppText>
            </AppCard>
          </Pressable>
        ))}
      </View>

      <View style={{ gap: t.space.sm }}>
        <AppText variant="sectionTitle" accessibilityRole="header">In the pantry</AppText>
        {pantry.isLoading ? <Skeleton width="100%" height={120} radius={20} /> : items.length === 0
          ? <EmptyState icon={Package} title="Pantry is empty" body="Add what you have to see recipes you can make and keep it off the grocery list." /> : (
          <AppCard padded={false}>
            {items.map((p, i) => {
              const soon = p.expiresOn && p.expiresOn <= addDays(today(), 2);
              return (
                <Pressable key={p.id} onPress={() => setEditing(p)} accessibilityRole="button" accessibilityHint="Change amount, use-by date or remove"
                  style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: t.space.md, minHeight: 56, paddingHorizontal: t.space.lg, paddingVertical: t.space.sm, borderTopWidth: i ? 1 : 0, borderTopColor: t.colors.border }, pressed && { backgroundColor: t.colors.surfaceMuted }]}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <AppText variant="body">{p.name}</AppText>
                    <AppText variant="caption" tone="muted" numeric>
                      {[p.grams ? `${Math.round(p.grams)} g` : null, p.expiresOn ? `use by ${p.expiresOn}` : null].filter(Boolean).join(' · ') || 'Amount not tracked'}
                    </AppText>
                  </View>
                  {p.isStaple ? <Badge label="Staple" /> : null}
                  {soon ? <Badge label="Use soon" tone="warning" /> : null}
                  <ChevronRight size={18} color={t.colors.textMuted} />
                </Pressable>
              );
            })}
          </AppCard>
        )}
      </View>

      <PantryItemSheet item={editing} saving={m.update.isPending} onClose={() => setEditing(null)} onRemove={remove}
        onSave={async (r) => {
          try { await m.update.mutateAsync(r); setEditing(null); snackbar({ message: `Updated ${r.name}` }); }
          catch (e) { snackbar({ message: e instanceof Error ? e.message : "Couldn't save" }); }
        }} />
    </ScrollView>
  );
}

function Input(props: React.ComponentProps<typeof TextInput>) {
  const t = useTheme();
  return <TextInput placeholderTextColor={t.colors.textMuted} {...props}
    style={[t.type.body, { minHeight: 48, minWidth: 0, paddingHorizontal: t.space.md, borderRadius: t.radii.button, borderWidth: 1, borderColor: t.colors.border, backgroundColor: t.colors.surfaceMuted, color: t.colors.text }]} />;
}

function PantryItemSheet({ item, saving, onSave, onRemove, onClose }: {
  item: PantryItem | null; saving: boolean;
  onSave: (r: { id: string; name: string; foodId?: string | null; grams?: number | null; expiresOn?: string | null; isStaple: boolean }) => void;
  onRemove: (p: PantryItem) => void; onClose: () => void;
}) {
  const t = useTheme();
  const [draft, setDraft] = useState<{ id: string; name: string; grams: string; expiresOn: string | null; isStaple: boolean } | null>(null);
  if (item && draft?.id !== item.id) setDraft({ id: item.id, name: item.name, grams: item.grams ? String(Math.round(item.grams)) : '', expiresOn: item.expiresOn ?? null, isStaple: item.isStaple });
  if (!item || !draft) return null;
  return (
    <BottomSheet visible={!!item} onClose={onClose} title={item.name}
      footer={<>
        <PrimaryButton label="Save" icon={Check} loading={saving} fullWidth disabled={!draft.name.trim()}
          onPress={() => onSave({ id: item.id, name: draft.name.trim(), foodId: item.foodId, grams: Number(draft.grams) > 0 ? Number(draft.grams) : null, expiresOn: draft.expiresOn, isStaple: draft.isStaple })} />
        <SecondaryButton label="Remove" icon={Trash2} tone="danger" fullWidth onPress={() => onRemove(item)} />
      </>}>
      <View style={{ gap: t.space.md }}>
        <Input value={draft.name} onChangeText={(v) => setDraft({ ...draft, name: v })} accessibilityLabel="Name" />
        <Input value={draft.grams} onChangeText={(v) => setDraft({ ...draft, grams: v })} placeholder="Amount in grams" keyboardType="decimal-pad" accessibilityLabel="Amount in grams" />
        <AppText variant="label" tone="secondary">Use by</AppText>
        <View style={{ flexDirection: 'row', gap: t.space.sm, flexWrap: 'wrap' }}>
          <FilterChip label="No date" selected={!draft.expiresOn} onPress={() => setDraft({ ...draft, expiresOn: null })} />
          {USE_WITHIN.map((d) => { const date = addDays(today(), d); return <FilterChip key={d} label={`${d} days`} selected={draft.expiresOn === date} onPress={() => setDraft({ ...draft, expiresOn: date })} />; })}
        </View>
        {draft.expiresOn && !USE_WITHIN.some((d) => addDays(today(), d) === draft.expiresOn) ? <AppText variant="caption" tone="muted">Currently: use by {draft.expiresOn}</AppText> : null}
        <FilterChip label="Staple (always on hand)" selected={draft.isStaple} onPress={() => setDraft({ ...draft, isStaple: !draft.isStaple })} />
      </View>
    </BottomSheet>
  );
}
