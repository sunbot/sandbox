import { useEffect, useState } from 'react';
import { Alert, FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useRecipeMutations, useRecipes } from '@/api/hooks';
import { loadSettings } from '@/lib/settings';
import { MacroLine } from '@/components/charts';
import { Button, Card, Empty, ErrorView, Field, Loading } from '@/components/ui';
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

  const importPaprika = async () => {
    const pick = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
    if (pick.canceled || !pick.assets?.[0]) return;
    const a = pick.assets[0];
    try {
      const result = await m.importPaprika.mutateAsync({ uri: a.uri, name: a.name, mimeType: a.mimeType });
      Alert.alert('Paprika import', `${result.imported} new, ${result.updated} updated.${result.errors.length ? `\n${result.errors.join('\n')}` : ''}\nOpen a recipe to check ingredient matches.`);
    } catch (e) {
      Alert.alert('Import failed', e instanceof Error ? e.message : String(e));
    }
  };

  const importUrl = async () => {
    try {
      const r = await m.importUrl.mutateAsync(url.trim());
      setUrl('');
      router.push({ pathname: '/recipe/[id]', params: { id: r.summary.id } });
    } catch (e) {
      Alert.alert('Import failed', e instanceof Error ? e.message : String(e));
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
            <Button title="Paprika export (.paprikarecipes)" variant="secondary" icon="📥" onPress={importPaprika} loading={m.importPaprika.isPending} />
            <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
              <View style={{ flex: 1 }}><Field value={url} onChangeText={setUrl} placeholder="https://… recipe link" autoCapitalize="none" keyboardType="url" /></View>
              <Button title="Import" compact onPress={importUrl} disabled={!url.trim()} loading={m.importUrl.isPending} />
            </View>
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
              <View style={[styles.photo, styles.placeholder]}><Text style={{ fontSize: 24 }}>🍲</Text></View>
            )}
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={font.heading} numberOfLines={2}>{r.isFavorite ? '★ ' : ''}{r.name}</Text>
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
});
