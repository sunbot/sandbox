import { useCallback, useState } from 'react';
import { FlatList, Pressable, TextInput, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useRecipeMutations, useRecipes } from '@/api/hooks';
import { AppCard, AppText, Badge, EmptyState, PrimaryButton, SearchField, SecondaryButton, Skeleton, TextButton } from '@/components/ds';
import { ChefHat, ChevronRight, Download, Plus, Star } from '@/components/ds/icons';
import { paprikaImportError, urlImportError, type ImportNotice } from '@/features/recipe/importNotice';
import { RecipeThumb } from '@/features/recipe/RecipeThumb';
import { RematchAllSheet } from '@/features/recipe/RematchAllSheet';
import { matchNote } from '@/features/foods/foodRows';
import { useServerAuth } from '@/lib/authImage';
import { useTheme } from '@/theme/ThemeProvider';

const r0 = (n: number) => Math.round(n);

/** Your recipe box: search, import from Paprika or a link, or write one yourself. */
export default function RecipesScreen() {
  const t = useTheme();
  const { planDate } = useLocalSearchParams<{ planDate?: string }>();
  const [search, setSearch] = useState('');
  const [url, setUrl] = useState('');
  const [rematching, setRematching] = useState(false);
  const recipes = useRecipes(search);
  const m = useRecipeMutations();
  const server = useServerAuth();

  // Shown next to the import method that produced them (not in an alert, which doesn't appear in the web version).
  const [fileNotice, setFileNotice] = useState<ImportNotice | null>(null);
  const [urlNotice, setUrlNotice] = useState<ImportNotice | null>(null);

  // The tab stays mounted while you're elsewhere: drop old results when leaving so they aren't stale on return.
  useFocusEffect(useCallback(() => () => { setFileNotice(null); setUrlNotice(null); }, []));

  const importPaprika = async () => {
    setFileNotice(null);
    const pick = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
    if (pick.canceled || !pick.assets?.[0]) return;
    const a = pick.assets[0];
    try {
      // On web the picker gives a real File; on Android a file:// copy in the cache.
      const result = await m.importPaprika.mutateAsync({ uri: a.uri, name: a.name, mimeType: a.mimeType, file: a.file });
      const total = result.imported + result.updated;
      setFileNotice({
        kind: total > 0 ? 'ok' : 'error',
        title: total > 0
          ? `Imported ${total} recipe${total === 1 ? '' : 's'} (${result.imported} new, ${result.updated} updated)`
          : 'No recipes were imported',
        lines: [
          ...result.errors.slice(0, 5),
          ...(result.errors.length > 5 ? [`…and ${result.errors.length - 5} more problems`] : []),
          ...(total > 0 ? ['Open a recipe to check its ingredient matches.'] : []),
        ],
      });
    } catch (e) {
      setFileNotice(paprikaImportError(e instanceof Error ? e.message : String(e)));
    }
  };

  const importUrl = async () => {
    setUrlNotice(null);
    try {
      const r = await m.importUrl.mutateAsync(url.trim());
      setUrl('');
      router.push({ pathname: '/recipe/[id]', params: { id: r.summary.id } });
    } catch (e) {
      setUrlNotice(urlImportError(e instanceof Error ? e.message : String(e)));
    }
  };

  const noticeBox = (n: ImportNotice | null, actions?: React.ReactNode) => n ? (
    <View accessibilityLiveRegion="polite" style={{ gap: t.space.sm, padding: t.space.md, borderRadius: t.radii.button, backgroundColor: n.kind === 'error' ? t.colors.errorLight : t.colors.primaryLight }}>
      <AppText variant="bodyStrong" tone={n.kind === 'error' ? 'error' : 'default'}>{n.title}</AppText>
      {n.lines.map((l, i) => <AppText key={i} variant="secondary" tone="secondary">{l}</AppText>)}
      {actions}
    </View>
  ) : null;

  const list = recipes.data ?? [];

  return (
    <>
    <FlatList
      style={{ flex: 1, backgroundColor: t.colors.background }}
      contentContainerStyle={{ padding: t.screenPadding, gap: t.space.sm, paddingBottom: t.space.huge }}
      data={list}
      keyExtractor={(r) => r.id}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={
        <View style={{ gap: t.space.md, marginBottom: t.space.sm }}>
          {planDate ? <AppText variant="label" tone="primary">Pick a recipe to plan</AppText> : null}
          <SearchField value={search} onChangeText={setSearch} onClear={() => setSearch('')} placeholder="Search recipes or categories" accessibilityLabel="Search recipes" />
          <PrimaryButton label="New recipe" icon={Plus} onPress={() => router.push('/recipe/edit')} />
          <AppCard style={{ gap: t.space.md }}>
            <AppText variant="cardTitle">Import from website</AppText>
            <View style={{ flexDirection: 'row', gap: t.space.sm, alignItems: 'center' }}>
              <TextInput value={url} onChangeText={(v) => { setUrl(v); setUrlNotice(null); }} placeholder="Paste a recipe link" autoCapitalize="none" keyboardType="url" placeholderTextColor={t.colors.textMuted}
                accessibilityLabel="Recipe link" onSubmitEditing={() => url.trim() && importUrl()}
                style={[t.type.body, { flex: 1, minWidth: 0, minHeight: 48, paddingHorizontal: t.space.md, borderRadius: t.radii.button, borderWidth: 1, borderColor: t.colors.border, backgroundColor: t.colors.surfaceMuted, color: t.colors.text }]} />
              <SecondaryButton label="Import" onPress={importUrl} disabled={!url.trim()} loading={m.importUrl.isPending} />
            </View>
            {noticeBox(urlNotice, urlNotice?.fallback ? (
              <View style={{ gap: t.space.sm }}>
                <AppText variant="secondary" tone="secondary">You can paste the ingredients and instructions into a new recipe, or import a Paprika export if you have one.</AppText>
                <SecondaryButton label="Enter recipe manually" icon={Plus} onPress={() => router.push('/recipe/edit')} />
              </View>
            ) : null)}
            <AppText variant="caption" tone="muted">Works when the page publishes structured recipe data. Some sites block automated imports.</AppText>
          </AppCard>
          <AppCard style={{ gap: t.space.md }}>
            <AppText variant="cardTitle">Import Paprika file</AppText>
            <SecondaryButton label="Import Paprika file" icon={Download} onPress={importPaprika} loading={m.importPaprika.isPending} />
            {m.importPaprika.isPending ? <AppText variant="secondary" tone="secondary">Importing and matching ingredients… a large export can take a minute or two.</AppText> : null}
            {noticeBox(fileNotice)}
            <AppText variant="caption" tone="muted">In Paprika: select recipes → Share/Export → Paprika Recipe Format.</AppText>
          </AppCard>
          {list.length ? (
            <View style={{ flexDirection: 'row' }}>
              <TextButton label="Update ingredient matches…" onPress={() => setRematching(true)} />
            </View>
          ) : null}
        </View>
      }
      ListEmptyComponent={recipes.isLoading ? <View style={{ gap: t.space.sm }}>{[0, 1, 2].map((i) => <Skeleton key={i} width="100%" height={88} radius={20} />)}</View>
        : <EmptyState icon={ChefHat} title={search ? 'No recipes match' : 'No recipes yet'} body={search ? 'Try another word or category.' : 'Import from Paprika or a link, write one, or ask for ideas on the Ask tab.'} />}
      renderItem={({ item: r }) => (
        <Pressable onPress={() => router.push({ pathname: '/recipe/[id]', params: { id: r.id, planDate } })} accessibilityRole="button"
          accessibilityLabel={`${r.isFavorite ? 'Favorite. ' : ''}${r.name}, ${r0(r.perServing.calories)} calories per serving`}>
          {({ pressed }) => (
            <AppCard padded={false} style={pressed ? { backgroundColor: t.colors.surfaceMuted } : undefined}>
              <View style={{ flexDirection: 'row', gap: t.space.md, alignItems: 'center', padding: t.space.md }}>
                <RecipeThumb recipe={r} server={server} size={64} radius={t.radii.button} />
                <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    {r.isFavorite ? <Star size={16} strokeWidth={1.8} color={t.colors.accent} fill={t.colors.accent} /> : null}
                    <AppText variant="cardTitle" numberOfLines={2} style={{ flexShrink: 1 }}>{r.name}</AppText>
                  </View>
                  <AppText variant="secondary" tone="secondary" numeric>
                    {r0(r.perServing.calories)} kcal · P {r0(r.perServing.protein)} · C {r0(r.perServing.carbs)} · F {r0(r.perServing.fat)}
                  </AppText>
                  {matchNote(r) ? <AppText variant="caption" tone="muted" numberOfLines={2}>{matchNote(r)}</AppText> : null}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm, flexWrap: 'wrap' }}>
                    <AppText variant="caption" tone="muted" numberOfLines={1}>per serving · makes {r.servings}{r.categories.length ? ` · ${r.categories.slice(0, 2).join(', ')}` : ''}</AppText>
                    {r.coverage < 0.9 ? <Badge label={`${Math.round(r.coverage * 100)}% matched`} tone="warning" /> : null}
                  </View>
                </View>
                <ChevronRight size={18} color={t.colors.textMuted} />
              </View>
            </AppCard>
          )}
        </Pressable>
      )}
    />
    <RematchAllSheet visible={rematching} onClose={() => setRematching(false)} />
    </>
  );
}
