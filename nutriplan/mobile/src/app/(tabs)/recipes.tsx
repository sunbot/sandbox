import { useEffect, useState } from 'react';
import { FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useRecipeMutations, useRecipes } from '@/api/hooks';
import { loadSettings } from '@/lib/settings';
import { MacroLine } from '@/components/charts';
import { Button, Card, Empty, ErrorView, Field, Loading } from '@/components/ui';
import { Star, Utensils } from '@/components/ds/icons';
import { colors, font, radius, spacing } from '@/lib/theme';

/** Your recipe box. Import from Paprika (export file) or any recipe page link. */
export default function RecipesScreen() {
  const { planDate } = useLocalSearchParams<{ planDate?: string }>();
  const [search, setSearch] = useState('');
  const [url, setUrl] = useState('');
  const recipes = useRecipes(search);
  const m = useRecipeMutations();
  const [server, setServer] = useState({ apiUrl: '', apiKey: '' });
  useEffect(() => { loadSettings().then(setServer); }, []);

  // Shown on the screen (not in an alert, which doesn't appear in the web version).
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; title: string; lines: string[] } | null>(null);

  const importPaprika = async () => {
    setNotice(null);
    const pick = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
    if (pick.canceled || !pick.assets?.[0]) return;
    const a = pick.assets[0];
    try {
      // On web the picker gives a real File; on Android a file:// copy in the cache.
      const result = await m.importPaprika.mutateAsync({ uri: a.uri, name: a.name, mimeType: a.mimeType, file: a.file });
      const total = result.imported + result.updated;
      setNotice({
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
      setNotice({ kind: 'error', title: 'Import failed', lines: [e instanceof Error ? e.message : String(e)] });
    }
  };

  const importUrl = async () => {
    try {
      const r = await m.importUrl.mutateAsync(url.trim());
      setUrl('');
      router.push({ pathname: '/recipe/[id]', params: { id: r.summary.id } });
    } catch (e) {
      setNotice({ kind: 'error', title: 'Import failed', lines: [e instanceof Error ? e.message : String(e)] });
    }
  };

  return (
    <FlatList
      contentContainerStyle={styles.page}
      data={recipes.data ?? []}
      keyExtractor={(r) => r.id}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={
        <View style={{ gap: spacing.md, marginBottom: spacing.md }}>
          {planDate ? <Text style={[font.small, { color: colors.primary }]}>Pick a recipe to plan</Text> : null}
          <Field value={search} onChangeText={setSearch} placeholder="Search recipes or categories" />
          <Card style={{ gap: spacing.sm }}>
            <Text style={font.heading}>Import</Text>
            <Button title="Import Paprika export (.paprikarecipes)" variant="secondary" onPress={importPaprika} loading={m.importPaprika.isPending} />
            {m.importPaprika.isPending ? (
              <Text style={font.small}>Importing and matching ingredients… a large export can take a minute or two.</Text>
            ) : null}
            <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
              <View style={{ flex: 1 }}><Field value={url} onChangeText={setUrl} placeholder="https://… recipe link" autoCapitalize="none" keyboardType="url" /></View>
              <Button title="Import" compact onPress={importUrl} disabled={!url.trim()} loading={m.importUrl.isPending} />
            </View>
            {notice ? (
              <View accessibilityLiveRegion="polite" style={[styles.notice, notice.kind === 'error' && styles.noticeError]}>
                <Text style={[font.body, { fontWeight: '600', color: notice.kind === 'error' ? colors.high : colors.text }]}>{notice.title}</Text>
                {notice.lines.map((l, i) => <Text key={i} style={font.small}>{l}</Text>)}
              </View>
            ) : null}
            <Text style={font.tiny}>In Paprika: select recipes → Share/Export → Paprika Recipe Format. Links work when the page publishes structured recipe data (most recipe sites do).</Text>
          </Card>
        </View>
      }
      ListEmptyComponent={recipes.isLoading ? <Loading /> : recipes.error ? <ErrorView error={recipes.error} onRetry={() => recipes.refetch()} /> : <Empty title="No recipes yet" hint="Import from Paprika or a link, or ask the assistant for ideas." />}
      renderItem={({ item: r }) => (
        <Pressable onPress={() => router.push({ pathname: '/recipe/[id]', params: { id: r.id, planDate } })}>
          <Card style={styles.row}>
            {r.hasPhoto || r.imageUrl ? (
              <Image source={r.hasPhoto ? { uri: `${server.apiUrl}/api/recipes/${r.id}/photo`, headers: server.apiKey ? { 'X-Api-Key': server.apiKey } : undefined } : { uri: r.imageUrl! }} style={styles.photo} />
            ) : (
              <View style={[styles.photo, styles.placeholder]}><Utensils size={22} strokeWidth={1.6} color={colors.textMuted} /></View>
            )}
            <View style={{ flex: 1, gap: 2 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                {r.isFavorite ? <Star size={16} strokeWidth={1.8} color={colors.accent} fill={colors.accent} accessibilityLabel="Favorite" /> : null}
                <Text style={[font.heading, { flexShrink: 1 }]} numberOfLines={2}>{r.name}</Text>
              </View>
              <MacroLine n={r.perServing} compact />
              <Text style={font.tiny}>
                per serving · {r.servings} servings{r.coverage < 1 ? ` · ${Math.round(r.coverage * 100)}% matched` : ''}{r.categories.length ? ` · ${r.categories.slice(0, 2).join(', ')}` : ''}
              </Text>
            </View>
          </Card>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.lg, gap: spacing.sm, paddingBottom: spacing.xxl },
  row: { flexDirection: 'row', gap: spacing.md, alignItems: 'center', padding: spacing.md },
  photo: { width: 64, height: 64, borderRadius: radius.md, backgroundColor: colors.surfaceMuted },
  placeholder: { alignItems: 'center', justifyContent: 'center' },
  notice: { gap: 4, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceMuted },
  noticeError: { borderWidth: 1, borderColor: colors.high },
});
