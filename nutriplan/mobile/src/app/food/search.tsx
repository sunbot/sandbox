import { useState } from 'react';
import { ActivityIndicator, ScrollView, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { addBrandedFood, useBrandedSearch, useFoodSearch, useRecipes } from '@/api/hooks';
import type { BrandedFood } from '@/api/types';
import { AppText, EmptyState, SecondaryButton, Skeleton, TextButton } from '@/components/ds';
import { PenLine, ScanBarcode, Search } from '@/components/ds/icons';
import { VoiceButton } from '@/components/VoiceButton';
import { FoodResultRow } from '@/features/foods/FoodResultRow';
import { brandedNotice, brandedRow, localRow, packagedFirst, recipeMatches, recipeRow, withoutSaved } from '@/features/foods/foodRows';
import { useDebounced } from '@/lib/useDebounced';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * Type or speak a food or one of your recipes. Your recipes come first (marked "Your recipe"), then your foods and USDA's
 * generic foods, immediately; packaged products from USDA's branded
 * database load in their own section once you pause typing, so the list never reshuffles under your finger and a slow
 * or unavailable USDA never blocks your own foods.
 */
export default function FoodSearch() {
  const t = useTheme();
  const params = useLocalSearchParams<{ date: string; meal: string; mode: string; recipeId?: string }>();
  const [text, setText] = useState('');
  const settled = useDebounced(text, 500);
  const local = useFoodSearch(text);
  const branded = useBrandedSearch(settled);
  // Your recipes are searched after a short pause, and only once there's something to search for.
  const recipeText = useDebounced(text.trim(), 250);
  const recipeSearch = useRecipes(recipeText, recipeText.length >= 2);
  // In a recipe's ingredient search the recipe itself isn't offered (the server refuses loops either way).
  const recipes = recipeMatches(recipeText.length >= 2 ? recipeSearch.data ?? [] : [], recipeText, params.mode === 'ingredient' ? params.recipeId : undefined);
  const RECIPES_SHOWN = 5;
  const [opening, setOpening] = useState<string | null>(null);
  // A short local list keeps the packaged-products section in view; the rest is one tap away.
  const [showAll, setShowAll] = useState<string | null>(null);
  const LOCAL_SHOWN = 8;
  const [openError, setOpenError] = useState<string | null>(null);
  // Recipe ingredients are matched by weight; drinks labelled per 100 ml can't be, so branded search is for logging and planning.
  const showBranded = params.mode !== 'ingredient';

  const open = (id: string) => router.push({ pathname: '/food/[id]', params: { ...params, id } });
  // The chosen recipe is `id`; in ingredient mode `recipeId` stays the recipe being edited.
  const openRecipe = (id: string) => router.push({ pathname: '/recipe/amount', params: { ...params, id } });
  const openBranded = async (b: BrandedFood) => {
    if (b.localFoodId) return open(b.localFoodId);
    setOpening(b.sourceId);
    setOpenError(null);
    try { open((await addBrandedFood(b.sourceId)).id); }
    catch (e) { setOpenError(e instanceof Error ? e.message : 'Couldn’t open that product.'); }
    finally { setOpening(null); }
  };

  const localFoods = local.data ?? [];
  const brandedFoods = withoutSaved(branded.data?.results ?? [], localFoods);
  const notice = brandedNotice(branded.data?.failure);
  const brandFirst = showBranded && packagedFirst(settled, localFoods, branded.data?.results ?? []);
  const waitingForPause = showBranded && text.trim().length >= 3 && text !== settled;

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background }}>
      <View style={{ padding: t.screenPadding, paddingBottom: t.space.sm, gap: t.space.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm }}>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: t.space.sm, minHeight: 48, paddingHorizontal: t.space.md, borderRadius: t.radii.button, backgroundColor: t.colors.surfaceMuted }}>
            <Search size={18} strokeWidth={2} color={t.colors.textMuted} />
            <TextInput value={text} onChangeText={setText} placeholder="Foods, your recipes or brands" placeholderTextColor={t.colors.textMuted}
              autoFocus returnKeyType="search" accessibilityLabel="Search foods and recipes" maxLength={100}
              style={[t.type.body, { flex: 1, minHeight: 48, color: t.colors.text }]} />
          </View>
          <VoiceButton onText={setText} onFinal={setText} />
        </View>
        <View style={{ flexDirection: 'row', gap: t.space.sm }}>
          <SecondaryButton label="Scan barcode" icon={ScanBarcode} onPress={() => router.replace({ pathname: '/scan', params })} style={{ flex: 1 }} />
          <SecondaryButton label="From label" icon={PenLine} onPress={() => router.push({ pathname: '/custom-food', params })} style={{ flex: 1 }} />
        </View>
      </View>

      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: t.screenPadding, paddingBottom: t.space.huge, gap: t.space.lg }}>
        {recipes.length > 0 ? (
          <View>
            <AppText variant="label" tone="secondary" accessibilityRole="header" style={{ paddingVertical: t.space.sm }}>Your recipes</AppText>
            {(showAll === `r:${text}` ? recipes : recipes.slice(0, RECIPES_SHOWN)).map((r) => <FoodResultRow key={r.id} row={recipeRow(r)} onPress={() => openRecipe(r.id)} />)}
            {showAll !== `r:${text}` && recipes.length > RECIPES_SHOWN ? <TextButton label={`Show ${recipes.length - RECIPES_SHOWN} more recipes`} onPress={() => setShowAll(`r:${text}`)} /> : null}
          </View>
        ) : null}
        {/* Brand searches that your foods don't cover show packaged products first; everything else, your foods first. */}
        {brandFirst ? <>
        {showBranded && text.trim().length >= 3 ? (
          <View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm, paddingVertical: t.space.sm }}>
              <AppText variant="label" tone="secondary" accessibilityRole="header" style={{ flex: 1 }}>Packaged products (USDA)</AppText>
              {waitingForPause || branded.isFetching ? <ActivityIndicator size="small" color={t.colors.textMuted} accessibilityLabel="Searching USDA" /> : null}
            </View>
            {notice ? <AppText variant="secondary" tone="secondary" accessibilityLiveRegion="polite" style={{ paddingBottom: t.space.sm }}>{notice}</AppText> : null}
            {branded.error ? <AppText variant="secondary" tone="secondary" accessibilityLiveRegion="polite">{branded.error instanceof Error ? branded.error.message : 'Branded search failed.'} Your own foods still work.</AppText> : null}
            {openError ? <AppText variant="secondary" tone="error" accessibilityLiveRegion="polite" style={{ paddingBottom: t.space.sm }}>{openError}</AppText> : null}
            {brandedFoods.map((b) => <FoodResultRow key={b.sourceId} row={brandedRow(b)} busy={opening === b.sourceId} onPress={() => openBranded(b)} />)}
            {branded.data && !branded.isFetching && !notice && brandedFoods.length === 0 ? <AppText variant="secondary" tone="muted" style={{ paddingVertical: t.space.sm }}>No packaged products match. Try the brand and product name.</AppText> : null}
            {branded.data?.attribution && brandedFoods.length ? <AppText variant="caption" tone="muted" style={{ paddingTop: t.space.sm }}>{branded.data.attribution}</AppText> : null}
          </View>
        ) : null}

        {text.trim().length < 2 ? (
          <AppText variant="secondary" tone="secondary">Search generic foods (chicken breast, rice) or a brand and product (Chobani greek yogurt, Dave’s Killer Bread).</AppText>
        ) : (
          <View>
            <AppText variant="label" tone="secondary" accessibilityRole="header" style={{ paddingVertical: t.space.sm }}>Your foods & USDA</AppText>
            {local.isFetching && !local.data ? <Skeleton width="100%" height={64} /> : null}
            {(showAll === text ? localFoods : localFoods.slice(0, LOCAL_SHOWN)).map((f) => <FoodResultRow key={f.id} row={localRow(f)} onPress={() => open(f.id)} />)}
            {showAll !== text && localFoods.length > LOCAL_SHOWN ? <TextButton label={`Show ${localFoods.length - LOCAL_SHOWN} more`} onPress={() => setShowAll(text)} /> : null}
            {!local.isFetching && local.data && localFoods.length === 0 ? <AppText variant="secondary" tone="muted" style={{ paddingVertical: t.space.sm }}>No matches in your foods.</AppText> : null}
          </View>
        )}

        </> : <>
        {text.trim().length < 2 ? (
          <AppText variant="secondary" tone="secondary">Search generic foods (chicken breast, rice) or a brand and product (Chobani greek yogurt, Dave’s Killer Bread).</AppText>
        ) : (
          <View>
            <AppText variant="label" tone="secondary" accessibilityRole="header" style={{ paddingVertical: t.space.sm }}>Your foods & USDA</AppText>
            {local.isFetching && !local.data ? <Skeleton width="100%" height={64} /> : null}
            {(showAll === text ? localFoods : localFoods.slice(0, LOCAL_SHOWN)).map((f) => <FoodResultRow key={f.id} row={localRow(f)} onPress={() => open(f.id)} />)}
            {showAll !== text && localFoods.length > LOCAL_SHOWN ? <TextButton label={`Show ${localFoods.length - LOCAL_SHOWN} more`} onPress={() => setShowAll(text)} /> : null}
            {!local.isFetching && local.data && localFoods.length === 0 ? <AppText variant="secondary" tone="muted" style={{ paddingVertical: t.space.sm }}>No matches in your foods.</AppText> : null}
          </View>
        )}

        {showBranded && text.trim().length >= 3 ? (
          <View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm, paddingVertical: t.space.sm }}>
              <AppText variant="label" tone="secondary" accessibilityRole="header" style={{ flex: 1 }}>Packaged products (USDA)</AppText>
              {waitingForPause || branded.isFetching ? <ActivityIndicator size="small" color={t.colors.textMuted} accessibilityLabel="Searching USDA" /> : null}
            </View>
            {notice ? <AppText variant="secondary" tone="secondary" accessibilityLiveRegion="polite" style={{ paddingBottom: t.space.sm }}>{notice}</AppText> : null}
            {branded.error ? <AppText variant="secondary" tone="secondary" accessibilityLiveRegion="polite">{branded.error instanceof Error ? branded.error.message : 'Branded search failed.'} Your own foods still work.</AppText> : null}
            {openError ? <AppText variant="secondary" tone="error" accessibilityLiveRegion="polite" style={{ paddingBottom: t.space.sm }}>{openError}</AppText> : null}
            {brandedFoods.map((b) => <FoodResultRow key={b.sourceId} row={brandedRow(b)} busy={opening === b.sourceId} onPress={() => openBranded(b)} />)}
            {branded.data && !branded.isFetching && !notice && brandedFoods.length === 0 ? <AppText variant="secondary" tone="muted" style={{ paddingVertical: t.space.sm }}>No packaged products match. Try the brand and product name.</AppText> : null}
            {branded.data?.attribution && brandedFoods.length ? <AppText variant="caption" tone="muted" style={{ paddingTop: t.space.sm }}>{branded.data.attribution}</AppText> : null}
          </View>
        ) : null}

        </>}
        {text.trim().length >= 2 && !local.isFetching && localFoods.length === 0 && recipes.length === 0 && (!showBranded || (branded.data && brandedFoods.length === 0)) ? (
          <EmptyState title="Nothing found" body="Try fewer words, scan the barcode, or add it from the label." />
        ) : null}
      </ScrollView>
    </View>
  );
}
