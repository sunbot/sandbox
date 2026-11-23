import { useState } from 'react';
import { Linking, ScrollView, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useLogRecipe, usePlanMutations, useRecipe, useRecipeMutations } from '@/api/hooks';
import { AppCard, AppText, ConfirmationSheet, EmptyState, FilterChip, PrimaryButton, SecondaryButton, SectionHeader, Skeleton, TextButton, useSnackbar } from '@/components/ds';
import { CalendarPlus, Check, ChefHat, CircleAlert, ExternalLink, Layers, Plus, RefreshCw } from '@/components/ds/icons';
import { IngredientNutritionRow } from '@/features/recipe/IngredientNutritionRow';
import { IngredientSheet } from '@/features/recipe/IngredientSheet';
import { QuantityPicker, type QuantityValue } from '@/features/quantity/QuantityPicker';
import { checkQuantity, matchMeasure, parseQuantity, roundAmount, SERVING } from '@/features/quantity/quantity';
import { NutritionSummary } from '@/features/recipe/NutritionSummary';
import { RecipeHeader } from '@/features/recipe/RecipeHeader';
import { ServingModeSelector } from '@/features/recipe/ServingModeSelector';
import {
  SCALE_CHOICES, availableModes, effectiveMode, eatingNutrition, gramsPerServing, ingredientCounts, logRecipeRequest, nextToReview, nutritionFor, parseServings, reliabilityNote, reviewQueue,
  scaleSummary, servingsWord, type NutritionMode,
} from '@/features/recipe/nutritionView';
import { addDays, dayLabel, mealForNow, meals, type Meal, today } from '@/lib/format';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * Recipe nutrition is computed from each ingredient's matched food and grams. Three separate ideas live on this
 * screen and are kept apart: how the numbers are SHOWN (per serving / whole recipe / per 100 g), how many servings the
 * recipe MAKES (yield), and how much YOU are logging or planning.
 */
export default function RecipeScreen() {
  const t = useTheme();
  const snackbar = useSnackbar();
  const { id, planDate } = useLocalSearchParams<{ id: string; planDate?: string }>();
  const recipe = useRecipe(id);
  const m = useRecipeMutations();
  const plan = usePlanMutations();
  const logRecipe = useLogRecipe();
  const [amount, setAmount] = useState<QuantityValue>({ text: '1', unit: 'serving' }); // how much I'm having, in the recipe's measures
  const [reviewing, setReviewing] = useState(false); // stepping through lines that need a look
  const [meal, setMeal] = useState<Meal>(mealForNow);
  const [batchDays, setBatchDays] = useState('3');
  const [mode, setMode] = useState<NutritionMode>('serving');
  // Everything that needs reading stays on screen rather than in alerts, which don't appear in the web version.
  const [notice, setNotice] = useState<string | null>(null);
  // The position, not a copy: the sheet always shows the ingredient as it is now, after any refetch.
  const [openPos, setOpenPos] = useState<number | null>(null);
  const [yieldText, setYieldText] = useState<string | null>(null); // non-null while editing "makes N servings"
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleted, setDeleted] = useState(false); // set once the delete succeeded, so the refetch 404 never shows
  const [scaling, setScaling] = useState<number | null>(null); // a chosen factor, waiting for Apply

  if (recipe.isLoading || deleted) {
    return <View style={{ padding: t.screenPadding, gap: t.space.md }}><Skeleton width="100%" height={96} radius={20} /><Skeleton width="100%" height={260} radius={20} /><Skeleton width="100%" height={200} radius={20} /></View>;
  }
  if (recipe.error || !recipe.data) {
    return <EmptyState icon={ChefHat} title="Couldn’t load this recipe" body={recipe.error instanceof Error ? recipe.error.message : 'Check your connection and try again.'}
      action={<SecondaryButton label="Try again" onPress={() => recipe.refetch()} />} />;
  }

  const r = recipe.data;
  const s = r.summary;
  const basis = { perServing: s.perServing, servings: s.servings, cookedWeightGrams: r.cookedWeightGrams };
  const modes = availableModes(basis);
  const shownMode = effectiveMode(mode, basis);
  const shown = nutritionFor(basis, shownMode) ?? s.perServing;
  const counts = ingredientCounts(r.ingredients);
  const note = reliabilityNote(s.coverage, counts);

  const measures = r.measures?.length ? r.measures : [SERVING];
  const amountMeasure = matchMeasure(measures, amount.unit) ?? measures[0];
  const amountQty = parseQuantity(amount.text);
  const amountCheck = checkQuantity(amountQty, amountMeasure, true, 'serving');
  const n = amountCheck.ok ? amountCheck.base : null; // servings, whatever measure it was typed in
  const asChosen = n && amountQty ? { amount: roundAmount(amountQty), unit: amountMeasure.unit } : {};
  const eating = n ? eatingNutrition(s.perServing, n) : null;
  const queue = reviewQueue(r.ingredients);
  const logDate = today();

  const run = async (action: () => Promise<unknown>, done?: string) => {
    try { await action(); if (done) setNotice(done); } catch (e) { setNotice(e instanceof Error ? e.message : String(e)); }
  };

  const addToPlan = () => n && run(async () => {
    await plan.addRecipe.mutateAsync({ date: planDate ?? logDate, meal, recipeId: s.id, servings: roundAmount(n), ...asChosen });
    router.back();
  });

  const logNow = () => n && run(async () => {
    // The meal the user picked above, never a time-of-day guess.
    await logRecipe.mutateAsync(logRecipeRequest({ date: logDate, meal, recipeId: s.id, servings: roundAmount(n), ...asChosen }));
    snackbar({ message: `Logged ${servingsWord(n)} to ${meal.toLowerCase()} today` });
  });

  const batch = () => n && run(async () => {
    const days = Math.max(1, Math.min(7, Number(batchDays) || 1));
    const start = planDate ?? logDate;
    await plan.addBatch.mutateAsync({ recipeId: s.id, servingsPerPortion: n, slots: Array.from({ length: days }, (_, i) => ({ date: addDays(start, i), meal })) });
    setNotice(`Planned ${days} portions of ${s.name}, ${meal.toLowerCase()} from ${dayLabel(start)}. It's on the grocery list once.`);
  });

  const saveYield = async () => {
    const v = parseServings(yieldText ?? '');
    if (!v) return setNotice('Enter how many servings the whole recipe makes.');
    await run(async () => {
      await m.setServings.mutateAsync({ id: s.id, servings: v });
      setYieldText(null);
    }, `Now ${servingsWord(v)}: per-serving numbers updated.`);
  };

  const applyScale = (factor: number) => run(async () => {
    const d = await m.scale.mutateAsync({ id: s.id, factor });
    setScaling(null);
    setNotice(`Scaled ×${factor}: now ${servingsWord(d.summary.servings)}. Every amount changed; per-serving numbers stay the same.`);
  });

  // After an action on a line: in a review, go on to the next line that needs a look; otherwise close the sheet.
  // (A removed line shifts the ones after it up by one.)
  const afterLine = (position: number, removed = false) => {
    if (!reviewing) return setOpenPos(null);
    const next = nextToReview(queue.filter((p) => p !== position), position);
    setOpenPos(next === null ? null : removed ? next - 1 : next);
    if (next === null) setReviewing(false);
  };

  const refreshMatches = () => run(async () => {
    const d = await m.rematch.mutateAsync(s.id);
    setNotice(`Ingredients re-matched: ${Math.round(d.summary.coverage * 100)}% now counted. Lines you chose or excluded were kept.`);
  });

  const input = [t.type.bodyStrong, { minHeight: 48, paddingHorizontal: t.space.md, color: t.colors.text, borderRadius: t.radii.button, backgroundColor: t.colors.surfaceMuted }] as const;

  return (
    <ScrollView contentContainerStyle={{ padding: t.screenPadding, gap: t.space.lg, paddingBottom: t.space.huge }} keyboardShouldPersistTaps="handled">
      <RecipeHeader recipe={r} onFavorite={() => m.favorite.mutate({ id: s.id, favorite: !s.isFavorite })}
        onEdit={() => router.push({ pathname: '/recipe/edit', params: { id: s.id } })} />
      {r.description ? <AppText variant="secondary" tone="secondary">{r.description}</AppText> : null}

      {notice ? (
        <AppCard style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm }}>
          <AppText variant="body" style={{ flex: 1 }} accessibilityLiveRegion="polite">{notice}</AppText>
          <TextButton label="OK" onPress={() => setNotice(null)} />
        </AppCard>
      ) : null}

      <AppCard style={{ gap: t.space.lg }} sheen>
        <ServingModeSelector modes={modes} value={shownMode} onChange={setMode} />
        <NutritionSummary nutrition={shown} mode={shownMode} makes={s.servings} gramsPerServing={gramsPerServing(basis)} reliability={note} />
        {modes.length < 3 ? (
          <AppText variant="caption" tone="muted">Per 100 g appears once you enter the finished dish’s weight in Edit recipe. It is never estimated from the ingredients.</AppText>
        ) : null}
        {r.sourceNutritionText ? <AppText variant="caption" tone="muted">The recipe source says: {r.sourceNutritionText}</AppText> : null}

        <View style={{ borderTopWidth: 1, borderTopColor: t.colors.border, paddingTop: t.space.md, gap: t.space.sm }}>
          {yieldText === null ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm, flexWrap: 'wrap' }}>
              <AppText variant="secondary" tone="secondary" style={{ flex: 1 }}>This recipe makes {servingsWord(s.servings)}</AppText>
              <TextButton label="Change" onPress={() => setYieldText(String(s.servings))} />
            </View>
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm, flexWrap: 'wrap' }}>
              <AppText variant="secondary" tone="secondary">Makes</AppText>
              <TextInput value={yieldText} onChangeText={setYieldText} keyboardType="decimal-pad" accessibilityLabel="Servings the whole recipe makes" style={[...input, { width: 90, textAlign: 'center' }]} />
              <PrimaryButton label="Save" onPress={saveYield} loading={m.setServings.isPending} />
              <TextButton label="Cancel" tone="secondary" onPress={() => setYieldText(null)} />
            </View>
          )}
          {yieldText === null ? (
            <View style={{ gap: t.space.xs }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm, flexWrap: 'wrap' }}>
                <AppText variant="secondary" tone="secondary">Scale recipe</AppText>
                {SCALE_CHOICES.map((f) => (
                  <FilterChip key={f} label={`×${f === 0.5 ? '½' : f === 1.5 ? '1½' : f}`} selected={scaling === f}
                    accessibilityLabel={`Scale the recipe by ${f}`} onPress={() => setScaling(scaling === f ? null : f)} />
                ))}
              </View>
              {scaling !== null ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm, flexWrap: 'wrap' }}>
                  <AppText variant="caption" tone="secondary" style={{ flex: 1, minWidth: 160 }}>{scaleSummary(s.servings, scaling)}</AppText>
                  <PrimaryButton label="Apply" onPress={() => applyScale(scaling)} loading={m.scale.isPending} />
                </View>
              ) : null}
            </View>
          ) : null}
          {s.servings === 1 && !r.servingDescription && yieldText === null ? (
            <AppText variant="caption" tone="warning">The recipe didn’t say how many servings it makes, so this is the whole recipe. Tap Change to set it.</AppText>
          ) : null}
        </View>
      </AppCard>

      <AppCard style={{ gap: t.space.lg }}>
        <SectionHeader title="Log or plan" />
        <View style={{ gap: t.space.xs }}>
          <AppText variant="label" tone="secondary">How much I’m having</AppText>
          <QuantityPicker measures={measures} value={{ text: amount.text, unit: amountMeasure.unit }} baseUnit="serving" onChange={setAmount}
            error={amountQty !== null && !amountCheck.ok ? amountCheck.message : null} />
          <AppText variant="body" tone="secondary" numeric accessibilityLiveRegion="polite">
            {eating ? `= ${Math.round(eating.calories)} kcal · P ${Math.round(eating.protein)} · C ${Math.round(eating.carbs)} · F ${Math.round(eating.fat)}` : ' '}
          </AppText>
        </View>
        <View style={{ gap: t.space.xs }}>
          <AppText variant="label" tone="secondary">Meal</AppText>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space.sm }}>
            {meals.map((x) => <FilterChip key={x} label={x === 'Snack' ? 'Snacks' : x} selected={x === meal} onPress={() => setMeal(x)} />)}
          </View>
        </View>
        <View style={{ gap: t.space.sm }}>
          <PrimaryButton label={`Log now · ${meal === 'Snack' ? 'snacks' : meal.toLowerCase()}`} icon={Check} disabled={!n} loading={logRecipe.isPending} onPress={logNow} fullWidth />
          <SecondaryButton label={planDate ? `Plan for ${dayLabel(planDate)}` : 'Plan for today'} icon={CalendarPlus} disabled={!n} loading={plan.addRecipe.isPending} onPress={addToPlan} fullWidth />
        </View>
        <View style={{ gap: t.space.xs, borderTopWidth: 1, borderTopColor: t.colors.border, paddingTop: t.space.md }}>
          <AppText variant="label" tone="secondary">Cook once, eat several times</AppText>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.md, flexWrap: 'wrap' }}>
            <TextInput value={batchDays} onChangeText={setBatchDays} keyboardType="number-pad" accessibilityLabel="Number of days to plan leftovers" style={[...input, { width: 72, textAlign: 'center' }]} />
            <AppText variant="secondary" tone="secondary">days</AppText>
            <SecondaryButton label="Plan leftovers" icon={Layers} disabled={!n} loading={plan.addBatch.isPending} onPress={batch} />
          </View>
        </View>
      </AppCard>

      <AppCard padded={false}>
        <View style={{ padding: t.space.lg, paddingBottom: t.space.sm, gap: t.space.xs }}>
          {/* Wraps under the title when large text leaves no room beside it. */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', columnGap: t.space.sm }}>
            <AppText variant="sectionTitle" accessibilityRole="header">Ingredients</AppText>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: t.space.sm }}>
              <TextButton label="Add" icon={Plus} onPress={() => router.push({ pathname: '/food/search', params: { mode: 'add-ingredient', recipeId: s.id } })} />
              <TextButton label="Refresh matches" icon={RefreshCw} onPress={refreshMatches} />
            </View>
          </View>
          <AppText variant="caption" tone="muted">
            {counts.counted} of {counts.total} counted{counts.unmatched ? ` · ${counts.unmatched} unmatched` : ''}{counts.check ? ` · ${counts.check} to check` : ''}{counts.excluded ? ` · ${counts.excluded} left out` : ''}. Tap one to change its food or amount.
          </AppText>
        </View>
        {queue.length > 0 ? (
          <View style={{ marginHorizontal: t.space.lg, marginBottom: t.space.sm, padding: t.space.md, gap: t.space.sm, borderRadius: t.radii.button, backgroundColor: t.colors.surfaceMuted, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
            <CircleAlert size={20} strokeWidth={1.8} color={t.colors.warning} />
            <AppText variant="secondary" style={{ flex: 1, minWidth: 160 }}>
              {queue.length === 1 ? '1 ingredient needs' : `${queue.length} ingredients need`} a look: no match, or a match to check. Until then, the numbers are a minimum.
            </AppText>
            <PrimaryButton label="Review" onPress={() => { setReviewing(true); setOpenPos(nextToReview(queue, null)); }} />
          </View>
        ) : null}
        <View style={{ paddingHorizontal: t.space.lg, paddingBottom: t.space.sm }}>
          {r.ingredients.map((ing) => <IngredientNutritionRow key={ing.position} ingredient={ing} onPress={() => setOpenPos(ing.position)} />)}
        </View>
      </AppCard>

      {r.usedIn?.length ? (
        <AppCard style={{ gap: t.space.xs }}>
          <SectionHeader title="Used in" />
          <AppText variant="caption" tone="muted">Changes here update these recipes too. Meals already logged keep their numbers.</AppText>
          {r.usedIn.map((u) => <TextButton key={u.id} label={u.name} icon={ChefHat} onPress={() => router.push({ pathname: '/recipe/[id]', params: { id: u.id } })} />)}
        </AppCard>
      ) : null}

      {r.directions ? (
        <AppCard style={{ gap: t.space.sm }}>
          <SectionHeader title="Directions" />
          <AppText variant="body" style={{ lineHeight: 24 }}>{r.directions}</AppText>
        </AppCard>
      ) : null}

      <View style={{ gap: t.space.sm }}>
        {r.sourceUrl ? <SecondaryButton label={`Open ${r.sourceName ?? 'source'}`} icon={ExternalLink} onPress={() => Linking.openURL(r.sourceUrl!)} fullWidth /> : null}
        <SecondaryButton label="Edit recipe" onPress={() => router.push({ pathname: '/recipe/edit', params: { id: s.id } })} fullWidth />
        <SecondaryButton label="Delete recipe" tone="danger" onPress={() => setConfirmDelete(true)} fullWidth />
      </View>

      <IngredientSheet ingredient={r.ingredients.find((i) => i.position === openPos) ?? null} onClose={() => { setOpenPos(null); setReviewing(false); }} busy={m.updateIngredient.isPending || m.removeIngredient.isPending}
        footerExtra={reviewing && openPos !== null ? (() => {
          const next = nextToReview(queue, openPos);
          const left = queue.filter((p) => p !== openPos).length;
          return next !== null
            ? <SecondaryButton label={`Next to review (${left} left)`} onPress={() => setOpenPos(next)} fullWidth />
            : <SecondaryButton label={left > 0 ? `Back to the first (${left} left)` : 'Done reviewing'} onPress={() => { if (left > 0) setOpenPos(nextToReview(queue, null)); else { setOpenPos(null); setReviewing(false); } }} fullWidth />;
        })() : undefined}
        onChooseFood={(ing) => { setOpenPos(null); setReviewing(false); router.push({ pathname: '/food/search', params: { mode: 'ingredient', recipeId: s.id, position: String(ing.position) } }); }}
        onLeaveOut={(ing) => run(async () => { await m.updateIngredient.mutateAsync({ id: s.id, position: ing.position, ignore: true }); afterLine(ing.position); })}
        onRecipeAmount={(ing) => { setOpenPos(null); setReviewing(false); router.push({ pathname: '/recipe/amount', params: { mode: 'ingredient', id: ing.recipeId!, recipeId: s.id, position: String(ing.position),
          ...(ing.amount != null && ing.servings ? { amount: String(ing.amount), unit: ing.unit ?? 'serving' } : {}) } }); }}
        onOpenRecipe={(rid) => { setOpenPos(null); setReviewing(false); router.push({ pathname: '/recipe/[id]', params: { id: rid } }); }}
        onSetAmount={(ing, amount, unit) => run(async () => { await m.updateIngredient.mutateAsync({ id: s.id, position: ing.position, amount, unit }); afterLine(ing.position); })}
        onRemove={(ing) => run(async () => { await m.removeIngredient.mutateAsync({ id: s.id, position: ing.position }); afterLine(ing.position, true); }, `Removed “${ing.rawText}”.`)} />

      <ConfirmationSheet visible={confirmDelete} title={`Delete ${s.name}?`} message="This can’t be undone. Meals you already logged or planned from it keep their nutrition."
        confirmLabel="Delete recipe" destructive loading={m.remove.isPending} onCancel={() => setConfirmDelete(false)}
        onConfirm={async () => {
          try {
            setDeleted(true);
            await m.remove.mutateAsync(s.id);
            setConfirmDelete(false);
            if (router.canDismiss()) router.dismissAll();
            router.replace('/recipes');
            snackbar({ message: `Deleted ${s.name}` });
          } catch (e) {
            setDeleted(false);
            setNotice(e instanceof Error ? e.message : String(e));
          }
        }} />
    </ScrollView>
  );
}
