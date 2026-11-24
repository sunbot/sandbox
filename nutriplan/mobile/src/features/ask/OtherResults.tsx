import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { usePlanMutations, useRecipeMutations } from '@/api/hooks';
import type { AssistantResponse, RecipeIdea, RecipeSummary } from '@/api/types';
import { AppCard, AppText, PrimaryButton, SecondaryButton } from '@/components/ds';
import { CalendarClock, Check, Sparkles } from '@/components/ds/icons';
import { dayLabel, mealForNow, today, type Meal } from '@/lib/format';
import { friendlyFoodName } from '@/lib/foodName';
import { ingredientState, matchDetail, recipeTrust, reviewQueue, trustLines } from '@/features/recipe/nutritionView';
import { useTheme } from '@/theme/ThemeProvider';

const r0 = (n: number) => Math.round(n);
const macros = (n: { calories: number; protein: number; carbs: number; fat: number }) =>
  `${r0(n.calories)} kcal · P ${r0(n.protein)} · C ${r0(n.carbs)} · F ${r0(n.fat)}`;

/**
 * Everything Ask returns besides foods to log: your recipes (with a Plan button when planning), new recipe ideas,
 * what you can cook from the pantry, and gap-filling suggestions. Behavior is unchanged from before; only the look.
 */
export function OtherResults({ r }: { r: AssistantResponse }) {
  const t = useTheme();
  const planning = r.intent === 'PlanMeal';
  const meal = (r.meal as Meal | null) ?? (planning ? 'Dinner' : mealForNow());
  return (
    <View style={{ gap: t.space.sm }}>
      {r.savedRecipes.map((s) => <SavedRecipe key={s.id} recipe={s} planning={planning} date={r.date} meal={meal} />)}
      {r.recipeIdeas.map((idea, i) => <IdeaCard key={i} idea={idea} />)}
      {r.cookable.map((c) => (
        <Pressable key={c.recipe.id} onPress={() => router.push({ pathname: '/recipe/[id]', params: { id: c.recipe.id } })} accessibilityRole="button">
          <AppCard style={{ gap: 2 }}>
            <AppText variant="cardTitle">{c.recipe.name}</AppText>
            <AppText variant="secondary" tone="secondary">
              {c.missing.length === 0 ? 'You have everything' : `Missing: ${c.missing.join(', ')}`}{c.usesExpiringSoon ? ' · uses something expiring soon' : ''}
            </AppText>
          </AppCard>
        </Pressable>
      ))}
      {r.gaps ? (
        <SecondaryButton label={r.gaps.suggestions.length > 0 ? `See ${r.gaps.suggestions.length} ${r.gaps.suggestions.length === 1 ? 'idea' : 'ideas'} for ${r.date === today() ? "today's" : 'the'} gaps` : 'Open Fill the gaps'} icon={Sparkles}
          onPress={() => router.push({ pathname: '/gaps', params: { date: r.date } })} fullWidth />
      ) : null}
    </View>
  );
}

function SavedRecipe({ recipe, planning, date, meal }: { recipe: RecipeSummary; planning: boolean; date: string; meal: Meal }) {
  const t = useTheme();
  const plan = usePlanMutations();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const when = date === today() ? 'today' : dayLabel(date).split(',')[0];
  return (
    <AppCard style={{ gap: t.space.xs }}>
      <Pressable onPress={() => router.push({ pathname: '/recipe/[id]', params: { id: recipe.id, planDate: planning ? date : undefined } })} accessibilityRole="button">
        <AppText variant="cardTitle">{recipe.name}</AppText>
        <AppText variant="secondary" tone="secondary" numeric>{macros(recipe.perServing)} · per serving · your recipe</AppText>
      </Pressable>
      {planning ? (
        <View style={{ alignSelf: 'flex-start', gap: t.space.xs }}>
          <PrimaryButton label={done ? 'Planned' : `Plan for ${when} · ${meal}`} icon={done ? Check : CalendarClock} disabled={done} loading={plan.addRecipe.isPending}
            onPress={async () => {
              try { await plan.addRecipe.mutateAsync({ date, meal, recipeId: recipe.id, servings: 1 }); setDone(true); setError(null); }
              catch (e) { setError(e instanceof Error ? e.message : String(e)); }
            }} />
          {error ? <AppText variant="secondary" tone="error">{error}</AppText> : null}
        </View>
      ) : null}
    </AppCard>
  );
}

function IdeaCard({ idea }: { idea: RecipeIdea }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const { create } = useRecipeMutations();
  const [error, setError] = useState<string | null>(null);
  const lines = idea.lines ?? [];
  const toReview = reviewQueue(lines).length;
  const trust = lines.length ? trustLines(recipeTrust(lines)) : [];
  const save = async () => {
    try {
      const saved = await create.mutateAsync({ name: idea.name, servings: idea.servings, ingredients: idea.ingredients, directions: idea.directions, description: idea.description });
      // Lines that need a look: open the saved recipe straight into Review, so they're fixed before it's used.
      router.push({ pathname: '/recipe/[id]', params: toReview ? { id: saved.summary.id, review: '1' } : { id: saved.summary.id } });
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  return (
    <AppCard style={{ gap: t.space.xs }}>
      <AppText variant="overline" tone="muted">RECIPE IDEA</AppText>
      <AppText variant="cardTitle">{idea.name}</AppText>
      {idea.description ? <AppText variant="secondary" tone="secondary">{idea.description}</AppText> : null}
      <AppText variant="secondary" numeric>{macros(idea.perServing)}</AppText>
      <AppText variant="caption" tone="muted">per serving · {idea.servings} servings · {Math.round(idea.coverage * 100)}% of ingredients matched (USDA data)</AppText>
      {open ? (
        <View style={{ gap: 2, marginTop: t.space.xs }}>
          {lines.length ? lines.map((l) => {
            const state = ingredientState(l);
            if (state === 'header') return <AppText key={l.position} variant="label" tone="secondary">{l.rawText}</AppText>;
            const result = state === 'unmatched' ? (l.note ?? 'Not matched: not counted')
              : state === 'excluded' ? (l.note ?? 'Not counted')
              : `${friendlyFoodName(l.foodName ?? '')}${l.grams != null ? ` · ${Math.round(l.grams)} g` : ''}${l.nutrition ? ` · ${Math.round(l.nutrition.calories)} kcal` : ''}`;
            const detail = state === 'unmatched' || state === 'excluded' ? null : [matchDetail(l), state === 'check' ? l.note : null].filter(Boolean).join(' · ');
            return (
              <View key={l.position} style={{ paddingVertical: 2 }} accessible accessibilityLabel={`${l.rawText}: ${result}${detail ? `. ${detail}` : ''}`}>
                <AppText variant="secondary">• {l.rawText}</AppText>
                <AppText variant="caption" tone={state === 'unmatched' || state === 'check' ? 'warning' : 'secondary'} style={{ paddingLeft: t.space.md }}>→ {result}</AppText>
                {detail ? <AppText variant="caption" tone="muted" style={{ paddingLeft: t.space.md }}>{detail}</AppText> : null}
              </View>
            );
          }) : idea.ingredients.map((l, i) => <AppText key={i} variant="secondary">• {l}</AppText>)}
          {trust.map((l) => <AppText key={l.label} variant="caption" tone={l.weak ? 'warning' : 'muted'}>{l.label}: {l.value}{l.detail ? `. ${l.detail}` : ''}</AppText>)}
          <AppText variant="secondary" style={{ marginTop: t.space.xs }}>{idea.directions}</AppText>
        </View>
      ) : null}
      {error ? <AppText variant="secondary" tone="error">{error}</AppText> : null}
      <View style={{ flexDirection: 'row', gap: t.space.sm, marginTop: t.space.xs }}>
        <SecondaryButton label={open ? 'Hide' : 'Ingredients'} onPress={() => setOpen(!open)} />
        <PrimaryButton label={toReview ? `Save and review (${toReview})` : 'Save recipe'} loading={create.isPending} onPress={save} />
      </View>
    </AppCard>
  );
}
