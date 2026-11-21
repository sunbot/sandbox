import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View, type ScrollViewInstance } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useAssistant, useLogFood, usePlanMutations, useRecipeMutations } from '@/api/hooks';
import type { AssistantResponse, FoodMatch, FoodMatchGroup, RecipeIdea } from '@/api/types';
import { MacroLine } from '@/components/charts';
import { Button, Card, Chip, Field, QualityBadge } from '@/components/ui';
import { VoiceButton } from '@/components/VoiceButton';
import { addDays, dayLabel, fromIsoDate, mealForNow, today, type Meal } from '@/lib/format';
import { Check } from '@/components/ds/icons';
import { colors, font, radius, spacing } from '@/lib/theme';

type Turn = { id: number; text: string; response?: AssistantResponse; error?: string };

const examples = ['2 eggs and toast for breakfast', 'half a pound of chicken breast', 'Christmas cookie recipes', 'What can I make with what I have?', 'What should I eat to hit my protein?'];

/**
 * Talk or type. The assistant turns what you say into choices — matched foods with amounts and
 * nutrition from the database, recipes, or gap-filling ideas. Nothing is logged until you tap Add.
 */
export default function AssistantScreen() {
  const [text, setText] = useState('');
  // Today's mic button opens Ask with ?listen=<token>; each new token starts listening once.
  const { listen } = useLocalSearchParams<{ listen?: string }>();
  const [listenToken, setListenToken] = useState<string | undefined>(listen);
  const [micNotice, setMicNotice] = useState<{ text: string; settings: boolean } | null>(null);
  useEffect(() => { if (listen) { setListenToken(listen); setMicNotice(null); } }, [listen]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const assistant = useAssistant();
  const scroll = useRef<ScrollViewInstance>(null);

  const send = async (message: string) => {
    const t = message.trim();
    if (!t) return;
    const id = Date.now();
    setTurns((prev) => [...prev, { id, text: t }]);
    setText('');
    try {
      const response = await assistant.mutateAsync({ text: t, date: today() });
      setTurns((prev) => prev.map((x) => (x.id === id ? { ...x, response } : x)));
    } catch (e) {
      setTurns((prev) => prev.map((x) => (x.id === id ? { ...x, error: e instanceof Error ? e.message : String(e) } : x)));
    }
    setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 100);
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <ScrollView ref={scroll} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        {turns.length === 0 && (
          <View style={{ gap: spacing.md }}>
            <Text style={font.title}>What did you eat, or what are you looking for?</Text>
            <Text style={font.small}>Speak or type naturally. You’ll get matches with amounts and nutrition to confirm.</Text>
            <View style={styles.examples}>{examples.map((e) => <Chip key={e} label={e} onPress={() => send(e)} />)}</View>
          </View>
        )}
        {turns.map((t) => (
          <View key={t.id} style={{ gap: spacing.sm }}>
            <View style={styles.userBubble}><Text style={{ color: colors.primaryText, fontSize: 15 }}>{t.text}</Text></View>
            {t.error ? <Text style={[font.small, { color: colors.danger }]}>{t.error}</Text> : null}
            {!t.response && !t.error ? <Text style={font.small}>Thinking…</Text> : null}
            {t.response ? <ResponseView r={t.response} /> : null}
          </View>
        ))}
      </ScrollView>

      {micNotice ? (
        <View style={styles.micNotice} accessibilityLiveRegion="polite">
          <Text style={[font.small, { flex: 1 }]}>{micNotice.text}</Text>
          {micNotice.settings ? <Button title="Settings" variant="secondary" compact onPress={() => Linking.openSettings()} /> : null}
        </View>
      ) : null}
      <View style={styles.inputBar}>
        <View style={{ flex: 1 }}>
          <Field value={text} onChangeText={setText} placeholder="e.g. a cup of oatmeal with blueberries" onSubmitEditing={() => send(text)} returnKeyType="send" />
        </View>
        <VoiceButton key={listenToken ?? 'mic'} autoStart={!!listenToken}
          onPermissionDenied={() => setMicNotice({ text: 'Microphone access is off. You can type instead, or allow it in your phone’s settings.', settings: true })}
          onUnavailable={(reason) => setMicNotice({ text: `${reason} You can type instead.`, settings: false })}
          onText={setText} onFinal={(final) => { setText(final); send(final); }} />
        <Button title="Send" compact onPress={() => send(text)} loading={assistant.isPending} />
      </View>
    </KeyboardAvoidingView>
  );
}

function ResponseView({ r }: { r: AssistantResponse }) {
  // Planning ("plan pizza for Friday dinner") puts food on the plan for that day, never in the diary.
  const planning = r.intent === 'PlanMeal';
  const meal = (r.meal ?? (planning ? 'Dinner' : mealForNow())) as Meal;
  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={font.body}>{r.reply}</Text>
      {r.savedRecipes.map((s) => (
        <Pressable key={s.id} onPress={() => router.push({ pathname: '/recipe/[id]', params: { id: s.id, planDate: planning ? r.date : undefined } })}>
          <Card style={{ gap: spacing.xs }}>
            <Text style={font.heading}>{s.name}</Text><MacroLine n={s.perServing} /><Text style={font.tiny}>per serving · from your recipes</Text>
            {planning ? <PlanRecipeButton recipeId={s.id} date={r.date} meal={meal} /> : null}
          </Card>
        </Pressable>
      ))}
      {r.foodMatches.map((g, i) => <MatchGroup key={i} group={g} date={r.date} meal={meal} planning={planning} />)}
      {r.recipeIdeas.map((idea, i) => <IdeaCard key={i} idea={idea} />)}
      {r.cookable.map((c) => (
        <Pressable key={c.recipe.id} onPress={() => router.push({ pathname: '/recipe/[id]', params: { id: c.recipe.id } })}>
          <Card>
            <Text style={font.heading}>{c.recipe.name}</Text>
            <Text style={font.small}>{c.missing.length === 0 ? 'You have everything' : `Missing: ${c.missing.join(', ')}`}{c.usesExpiringSoon ? ' · uses something expiring soon' : ''}</Text>
          </Card>
        </Pressable>
      ))}
      {r.gaps && <Button title={`See ${r.gaps.suggestions.length} ways to fill today's gaps`} variant="secondary" onPress={() => router.push({ pathname: '/gaps', params: { date: r.date } })} />}
      <Text style={font.tiny}>{r.usedLanguageModel ? 'Understood by Claude · numbers from the food database' : 'Understood offline · numbers from the food database'}</Text>
    </View>
  );
}

/** "Plan for Fri · Dinner": short enough for a button, specific enough to trust. */
const planLabel = (date: string, meal: Meal) => {
  const day = date === today() || date === addDays(today(), 1) ? dayLabel(date).toLowerCase() : fromIsoDate(date).toLocaleDateString(undefined, { weekday: 'short' });
  return `Plan for ${day} · ${meal}`;
};

function PlanRecipeButton({ recipeId, date, meal }: { recipeId: string; date: string; meal: Meal }) {
  const plan = usePlanMutations();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <View style={{ gap: spacing.xs, alignSelf: 'flex-start' }}>
      <Button title={done ? 'Planned' : planLabel(date, meal)} icon={done ? Check : undefined} compact disabled={done} loading={plan.addRecipe.isPending}
        onPress={async () => {
          try { await plan.addRecipe.mutateAsync({ date, meal, recipeId, servings: 1 }); setDone(true); setError(null); }
          catch (e) { setError(e instanceof Error ? e.message : String(e)); }
        }} />
      {error ? <Text style={[font.small, { color: colors.danger }]}>{error}</Text> : null}
    </View>
  );
}

function MatchGroup({ group, date, meal, planning }: { group: FoodMatchGroup; date: string; meal: Meal; planning: boolean }) {
  const [selected, setSelected] = useState(0);
  const [added, setAdded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const log = useLogFood();
  const plan = usePlanMutations();
  const match: FoodMatch | undefined = group.matches[selected];
  if (!match) return <Card><Text style={font.body}>No match for “{group.foodQuery}”.</Text></Card>;
  const mode = planning ? 'plan' : 'log';
  const busy = planning ? plan.addFood.isPending : log.isPending;

  const add = async () => {
    if (!match.quantity.grams) {
      router.push({ pathname: '/food/[id]', params: { id: match.food.id, date, meal, mode } });
      return;
    }
    try {
      if (planning) await plan.addFood.mutateAsync({ date, meal, foodId: match.food.id, grams: match.quantity.grams });
      else await log.mutateAsync({ date, meal, foodId: match.food.id, grams: match.quantity.grams });
      setAdded(true);
      setError(null);
    } catch (e) {
      // Shown on screen: alerts don't appear in the web version.
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Card style={{ gap: spacing.sm }}>
      <Text style={font.small}>“{group.text}”</Text>
      {group.matches.slice(0, 4).map((m, i) => (
        <Pressable key={m.food.id} onPress={() => setSelected(i)} style={[styles.match, i === selected && styles.matchSelected]}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={font.body} numberOfLines={2}>{m.food.name}{m.food.brand ? ` · ${m.food.brand}` : ''}</Text>
            <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
              <QualityBadge quality={m.food.quality} source={m.food.source} />
              <Text style={font.tiny} numberOfLines={1}>{m.quantity.grams ? `${Math.round(m.quantity.grams)} g` : 'choose amount'}</Text>
            </View>
          </View>
          <Text style={[font.body, font.number, { fontWeight: '600' }]}>{m.nutrition ? Math.round(m.nutrition.calories) : '—'}</Text>
        </Pressable>
      ))}
      {match.nutrition && <MacroLine n={match.nutrition} />}
      <Text style={font.tiny}>{match.quantity.explanation}</Text>
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <Button title={added ? (planning ? 'Planned' : 'Added') : planning ? planLabel(date, meal) : `Add to ${meal}`} icon={added ? Check : undefined}
          compact disabled={added} loading={busy} onPress={add} />
        <Button title="Adjust" variant="secondary" compact onPress={() => router.push({ pathname: '/food/[id]', params: { id: match.food.id, date, meal, mode, grams: match.quantity.grams ? String(match.quantity.grams) : undefined } })} />
      </View>
      {error ? <Text style={[font.small, { color: colors.danger }]}>{error}</Text> : null}
    </Card>
  );
}

function IdeaCard({ idea }: { idea: RecipeIdea }) {
  const [open, setOpen] = useState(false);
  const { create } = useRecipeMutations();
  const save = async () => {
    const saved = await create.mutateAsync({ name: idea.name, servings: idea.servings, ingredients: idea.ingredients, directions: idea.directions, description: idea.description });
    router.push({ pathname: '/recipe/[id]', params: { id: saved.summary.id } });
  };
  return (
    <Card style={{ gap: spacing.xs }}>
      <Text style={[font.tiny, { letterSpacing: 0.6 }]}>RECIPE IDEA</Text>
      <Text style={font.heading}>{idea.name}</Text>
      <Text style={font.small}>{idea.description}</Text>
      <MacroLine n={idea.perServing} />
      <Text style={font.tiny}>per serving · {idea.servings} servings · {Math.round(idea.coverage * 100)}% of ingredients matched</Text>
      {open && (
        <View style={{ gap: 2, marginTop: spacing.xs }}>
          {idea.ingredients.map((l, i) => <Text key={i} style={font.small}>• {l}</Text>)}
          <Text style={[font.small, { marginTop: spacing.xs }]}>{idea.directions}</Text>
        </View>
      )}
      <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs }}>
        <Button title={open ? 'Hide' : 'Ingredients'} variant="secondary" compact onPress={() => setOpen(!open)} />
        <Button title="Save recipe" compact loading={create.isPending} onPress={save} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl },
  examples: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  userBubble: { alignSelf: 'flex-end', backgroundColor: colors.primary, borderRadius: radius.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, maxWidth: '85%' },
  micNotice: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: colors.surfaceMuted, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  inputBar: { flexDirection: 'row', gap: spacing.sm, padding: spacing.md, alignItems: 'center', backgroundColor: colors.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  match: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: 'transparent' },
  matchSelected: { borderColor: colors.primary, backgroundColor: '#1F332D' },
});
