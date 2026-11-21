import { useState } from 'react';
import { ActivityIndicator, Linking, Pressable, TextInput, View } from 'react-native';
import { AppText, TextButton } from '@/components/ds';
import { ArrowUp } from '@/components/ds/icons';
import { VoiceButton } from '@/components/VoiceButton';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * The message field with the microphone built in. Voice fills the field as you speak and sends when you stop;
 * typing sends with the arrow (or the keyboard's send key). Listening, sending and voice problems show right here.
 */
export function Composer({ value, onChange, onSend, sending, listenToken }: {
  value: string;
  onChange: (v: string) => void;
  onSend: (text: string) => void;
  sending: boolean;
  /** A new token starts listening once (Today's mic button opens Ask this way). */
  listenToken?: string;
}) {
  const t = useTheme();
  const [listening, setListening] = useState(false);
  const [notice, setNotice] = useState<{ text: string; settings: boolean } | null>(null);
  const canSend = value.trim().length > 0 && !sending;

  return (
    <View style={{ paddingHorizontal: t.screenPadding, paddingTop: t.space.sm, paddingBottom: t.space.md, gap: t.space.xs, backgroundColor: t.colors.background, borderTopWidth: 1, borderTopColor: t.colors.cardBorder }}>
      {notice ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm }} accessibilityLiveRegion="polite">
          <AppText variant="secondary" tone="secondary" style={{ flex: 1 }}>{notice.text}</AppText>
          {notice.settings ? <TextButton label="Settings" onPress={() => Linking.openSettings()} /> : null}
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm, minHeight: 56, paddingLeft: t.space.lg, paddingRight: 4,
        borderRadius: t.radii.pill, backgroundColor: t.colors.surface, borderWidth: 1, borderColor: listening ? t.colors.primary : t.colors.border }}>
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder={listening ? 'Listening…' : 'What did you eat?'}
          placeholderTextColor={listening ? t.colors.primary : t.colors.textMuted}
          onSubmitEditing={() => canSend && onSend(value)}
          returnKeyType="send"
          accessibilityLabel="Describe what you ate or ask a question"
          style={[t.type.body, { flex: 1, minWidth: 0, color: t.colors.text, minHeight: 48, paddingVertical: t.space.sm }]}
        />
        <VoiceButton key={listenToken ?? 'mic'} autoStart={!!listenToken}
          onListeningChange={(l) => { setListening(l); if (l) setNotice(null); }}
          onPermissionDenied={() => setNotice({ text: 'Microphone access is off. You can type instead, or allow it in settings.', settings: true })}
          onUnavailable={(reason) => setNotice({ text: `${reason} You can type instead.`, settings: false })}
          onText={onChange} onFinal={(final) => { onChange(final); if (final.trim()) onSend(final); }} />
        <Pressable onPress={() => canSend && onSend(value)} disabled={!canSend} accessibilityRole="button" accessibilityLabel="Send"
          accessibilityState={{ disabled: !canSend, busy: sending }}
          style={({ pressed }) => [{ width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center',
            backgroundColor: canSend ? t.colors.primary : t.colors.surfaceMuted }, pressed && canSend && { backgroundColor: t.colors.primaryPressed }]}>
          {sending ? <ActivityIndicator color={t.colors.textOnPrimary} /> : <ArrowUp size={22} strokeWidth={2.2} color={canSend ? t.colors.textOnPrimary : t.colors.textMuted} />}
        </Pressable>
      </View>
    </View>
  );
}
