import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View, type ScrollViewInstance } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useAssistant } from '@/api/hooks';
import type { AssistantResponse } from '@/api/types';
import { AppCard, AppText, FilterChip, SecondaryButton, Skeleton } from '@/components/ds';
import { Composer } from '@/features/ask/Composer';
import { OtherResults } from '@/features/ask/OtherResults';
import { ReviewCard } from '@/features/ask/ReviewCard';
import { today } from '@/lib/format';
import { useTheme } from '@/theme/ThemeProvider';

type Turn = { id: number; text: string; response?: AssistantResponse; error?: string };

const examples = ['2 eggs and toast for breakfast', 'Plan salmon and rice for Friday dinner', 'What could I eat to hit my protein?', 'What can I make with what I have?'];

/**
 * Ask: say or type what you ate (or want to plan, or are looking for). Foods come back as one review with USDA
 * matches, amounts and calories — nothing is logged until you tap Log all.
 */
export default function AskScreen() {
  const t = useTheme();
  const [text, setText] = useState('');
  const { listen } = useLocalSearchParams<{ listen?: string }>();
  const [listenToken, setListenToken] = useState<string | undefined>(listen);
  useEffect(() => { if (listen) setListenToken(listen); }, [listen]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const assistant = useAssistant();
  const scroll = useRef<ScrollViewInstance>(null);
  // Android draws edge to edge, so the window doesn't resize for the keyboard: pad by its height on both platforms.
  const headerHeight = useHeaderHeight();

  const ask = async (id: number, message: string) => {
    setTurns((prev) => prev.map((x) => (x.id === id ? { id, text: message } : x)));
    try {
      const response = await assistant.mutateAsync({ text: message, date: today() });
      setTurns((prev) => prev.map((x) => (x.id === id ? { ...x, response } : x)));
    } catch (e) {
      setTurns((prev) => prev.map((x) => (x.id === id ? { ...x, error: e instanceof Error ? e.message : String(e) } : x)));
    }
    setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 100);
  };

  const send = (message: string) => {
    const m = message.trim();
    if (!m || assistant.isPending) return;
    const id = Date.now();
    setTurns((prev) => [...prev, { id, text: m }]);
    setText('');
    setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 50);
    ask(id, m);
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: t.colors.background }} behavior="padding" keyboardVerticalOffset={Platform.OS === 'web' ? 0 : headerHeight}>
      <ScrollView ref={scroll} style={{ flex: 1 }} keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: t.screenPadding, gap: t.space.lg, flexGrow: 1, justifyContent: turns.length ? 'flex-start' : 'flex-end' }}>
        {turns.length === 0 ? (
          <View style={{ gap: t.space.md }}>
            <View style={{ gap: t.space.xs }}>
              <AppText variant="sectionTitle" accessibilityRole="header">What did you eat?</AppText>
              <AppText variant="secondary" tone="secondary">Say or type it. You’ll review everything before it’s saved.</AppText>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space.sm }}>
              {examples.map((e) => <FilterChip key={e} label={e} onPress={() => send(e)} />)}
            </View>
          </View>
        ) : null}

        {turns.map((turn) => (
          <View key={turn.id} style={{ gap: t.space.sm }}>
            <View style={{ alignSelf: 'flex-end', maxWidth: '85%', backgroundColor: t.colors.primaryLight, borderRadius: t.radii.card, borderBottomRightRadius: 6, paddingHorizontal: t.space.lg, paddingVertical: t.space.sm }}>
              <AppText variant="body">{turn.text}</AppText>
            </View>
            {!turn.response && !turn.error ? <Thinking /> : null}
            {turn.error ? (
              <AppCard style={{ gap: t.space.sm }}>
                <AppText variant="body" tone="error" accessibilityLiveRegion="polite">{turn.error}</AppText>
                <View style={{ flexDirection: 'row' }}><SecondaryButton label="Try again" onPress={() => ask(turn.id, turn.text)} /></View>
              </AppCard>
            ) : null}
            {turn.response ? <Response r={turn.response} /> : null}
          </View>
        ))}
      </ScrollView>

      <Composer value={text} onChange={setText} onSend={send} sending={assistant.isPending} listenToken={listenToken} />
    </KeyboardAvoidingView>
  );
}

function Response({ r }: { r: AssistantResponse }) {
  const t = useTheme();
  const who = r.interpreter === 'Claude' || (!r.interpreter && r.usedLanguageModel) ? 'Understood by Claude'
    : r.interpreter === 'RulesFallback' ? 'Claude unavailable, built-in rules used'
    : 'Understood by built-in rules';
  const provenance = r.foodMatches.length ? `${who} · numbers from the USDA food database` : who;
  return (
    <View style={{ gap: t.space.sm, borderLeftWidth: 3, borderLeftColor: t.colors.primaryLight, paddingLeft: t.space.md }}>
      <AppText variant="body" tone="secondary">{r.reply}</AppText>
      {r.foodMatches.length ? <ReviewCard response={r} /> : null}
      <OtherResults r={r} />
      <View accessible accessibilityLabel={`Source: ${provenance}`} style={{ gap: t.space.xs }}>
        <AppText variant="caption" tone="muted">{provenance}</AppText>
        {r.interpreterNote && r.interpreter === 'RulesFallback' ? (
          <AppText variant="caption" tone="muted">{r.interpreterNote}</AppText>
        ) : null}
      </View>
    </View>
  );
}

function Thinking() {
  const t = useTheme();
  return (
    <AppCard style={{ gap: t.space.sm }} >
      <View accessible accessibilityLabel="Finding foods" accessibilityLiveRegion="polite" style={{ gap: t.space.sm }}>
        <AppText variant="secondary" tone="muted">Finding foods…</AppText>
        <Skeleton width="70%" height={14} />
        <Skeleton width="45%" height={14} />
      </View>
    </AppCard>
  );
}
