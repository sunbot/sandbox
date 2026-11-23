import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useRecipe, useRecipeMutations } from '@/api/hooks';
import type { RecipeDetail } from '@/api/types';
import { AppText, FilterChip, PrimaryButton, Skeleton, useSnackbar } from '@/components/ds';
import { volumeFromText, volumeText, type VolumeUnit } from '@/features/recipe/finishedVolume';
import { Check } from '@/components/ds/icons';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * Create a recipe, or edit one: name, servings, ingredient lines (one per line) and directions.
 * Nutrition is recalculated from the ingredients; lines you confirmed or left out keep their choice.
 */
export default function RecipeEditScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const t = useTheme();
  const recipe = useRecipe(id ?? '');
  if (id && recipe.isLoading) return <View style={{ flex: 1, backgroundColor: t.colors.background, padding: t.screenPadding, gap: t.space.lg }}><Skeleton width="100%" height={48} /><Skeleton width="100%" height={240} /></View>;
  return <Form key={id ?? 'new'} recipe={id ? recipe.data ?? null : null} />;
}

function Field({ label, multiline, ...props }: React.ComponentProps<typeof TextInput> & { label: string }) {
  const t = useTheme();
  return (
    <View style={{ gap: 4 }}>
      <AppText variant="label" tone="secondary">{label}</AppText>
      <TextInput placeholderTextColor={t.colors.textMuted} multiline={multiline} accessibilityLabel={label} textAlignVertical={multiline ? 'top' : 'center'} {...props}
        style={[t.type.body, { minHeight: multiline ? 140 : 48, minWidth: 0, paddingHorizontal: t.space.md, paddingVertical: t.space.sm, borderRadius: t.radii.button, borderWidth: 1, borderColor: t.colors.border, backgroundColor: t.colors.surfaceMuted, color: t.colors.text }]} />
    </View>
  );
}

function Form({ recipe }: { recipe: RecipeDetail | null }) {
  const t = useTheme();
  const snackbar = useSnackbar();
  const m = useRecipeMutations();
  const headerHeight = useHeaderHeight();
  const [name, setName] = useState(recipe?.summary.name ?? '');
  const [servings, setServings] = useState(String(recipe?.summary.servings ?? 4));
  const [lines, setLines] = useState((recipe?.ingredients ?? []).map((i) => i.rawText).join('\n'));
  const [directions, setDirections] = useState(recipe?.directions ?? '');
  const [description, setDescription] = useState(recipe?.description ?? '');
  const [cooked, setCooked] = useState(recipe?.cookedWeightGrams ? String(recipe.cookedWeightGrams) : '');
  const [volUnit, setVolUnit] = useState<VolumeUnit>('cups');
  const [volume, setVolume] = useState(volumeText(recipe?.finishedVolumeMl, 'cups'));
  const [volumeEdited, setVolumeEdited] = useState(false); // untouched: the stored ml is saved back exactly (no rounding drift)
  const [error, setError] = useState<string | null>(null);
  const ingredients = lines.split('\n').map((l) => l.trim()).filter(Boolean);
  const cookedValue = cooked.trim() === '' ? null : Number(cooked.replace(',', '.'));
  const cookedOk = cookedValue === null || (Number.isFinite(cookedValue) && cookedValue > 0);
  const volumeMl = volumeEdited ? volumeFromText(volume, volUnit) : recipe?.finishedVolumeMl ?? null;
  const volumeOk = volumeMl !== undefined;
  const valid = name.trim().length > 0 && Number(servings) > 0 && ingredients.length > 0 && cookedOk && volumeOk;

  const save = async () => {
    setError(null);
    const body = { name: name.trim(), servings: Number(servings), ingredients, directions: directions.trim() || undefined, description: description.trim() || undefined, cookedWeightGrams: cookedValue, finishedVolumeMl: volumeMl ?? null };
    try {
      const saved = recipe
        ? await m.edit.mutateAsync({ id: recipe.summary.id, ...body, categories: recipe.summary.categories, notes: recipe.notes ?? null })
        : await m.create.mutateAsync(body);
      snackbar({ message: recipe ? 'Recipe saved' : 'Recipe created' });
      router.replace({ pathname: '/recipe/[id]', params: { id: saved.summary.id } });
    } catch (e) { setError(e instanceof Error ? e.message : "Couldn't save the recipe"); }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: t.colors.background }} behavior={Platform.OS === 'web' ? undefined : 'padding'} keyboardVerticalOffset={headerHeight}>
      <ScrollView contentContainerStyle={{ padding: t.screenPadding, gap: t.space.lg, paddingBottom: t.space.huge }} keyboardShouldPersistTaps="handled">
        <Field label="Name" value={name} onChangeText={setName} placeholder="e.g. Turkey chili" />
        <Field label="Whole recipe makes (servings)" value={servings} onChangeText={setServings} keyboardType="decimal-pad" />
        <Field label="Ingredients — one per line" value={lines} onChangeText={setLines} multiline placeholder={'1 lb ground turkey\n1 can (15 oz) black beans\n1 tbsp chili powder'} />
        <AppText variant="caption" tone="muted">Each line is matched to USDA foods when you save. Anything uncertain is highlighted on the recipe for you to check.</AppText>
        <Field label="Directions (optional)" value={directions} onChangeText={setDirections} multiline />
        <Field label="Description (optional)" value={description} onChangeText={setDescription} />
        <Field label="Finished dish weight in grams (optional)" value={cooked} onChangeText={setCooked} keyboardType="decimal-pad" placeholder="e.g. 1200" />
        <AppText variant="caption" tone="muted">Weigh the cooked dish to see nutrition per 100 g. Leave it empty if you don’t know: it is never estimated from the ingredients.</AppText>
        {!cookedOk ? <AppText variant="secondary" tone="error" accessibilityLiveRegion="polite">Enter the weight as a positive number of grams, or leave it empty.</AppText> : null}
        <Field label={`Finished volume in ${volUnit} (optional)`} value={volume} onChangeText={(v) => { setVolume(v); setVolumeEdited(true); }} keyboardType="decimal-pad" placeholder={volUnit === 'cups' ? 'e.g. 8' : 'e.g. 1900'} />
        <View style={{ flexDirection: 'row', gap: t.space.sm }}>
          {(['cups', 'ml'] as const).map((u) => (
            <FilterChip key={u} label={u} selected={volUnit === u} onPress={() => { if (u !== volUnit) { setVolume(volumeText(volumeMl, u)); setVolUnit(u); } }} />
          ))}
        </View>
        <AppText variant="caption" tone="muted">For soups, sauces and drinks: measure the finished amount to log it in cups or ml. Never estimated from the ingredients.</AppText>
        {!volumeOk ? <AppText variant="secondary" tone="error" accessibilityLiveRegion="polite">Enter the volume as a positive number, or leave it empty.</AppText> : null}
        {error ? <AppText variant="secondary" tone="error" accessibilityLiveRegion="polite">{error}</AppText> : null}
        <PrimaryButton label={recipe ? 'Save recipe' : 'Create recipe'} icon={Check} disabled={!valid} loading={m.edit.isPending || m.create.isPending} onPress={save} fullWidth />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
