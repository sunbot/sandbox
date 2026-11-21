import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { useSnackbar } from '@/components/ds';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { Mic, Square } from '@/components/ds/icons';
import { colors } from '@/lib/theme';

/**
 * Hold-free voice input: tap to talk, tap again (or pause) to stop. Uses the phone's own speech
 * recognizer (on-device where available), so it's free and private. Emits interim + final text.
 *
 * `autoStart`: begin listening as soon as the button mounts (used when Today's mic button opens Ask).
 * `onPermissionDenied`: called instead of an alert when the microphone or speech permission is refused,
 * so the screen can explain inline and keep typing available.
 * `onUnavailable`: called with a plain-language reason for any other failure (no microphone, offline, …).
 * Screens should pass both: alerts don't display in the web version.
 */
export function VoiceButton({ onText, onFinal, autoStart, onPermissionDenied, onUnavailable, onListeningChange }: {
  onText: (text: string) => void;
  onFinal: (text: string) => void;
  autoStart?: boolean;
  onPermissionDenied?: () => void;
  onUnavailable?: (reason: string) => void;
  /** Told when listening starts and stops, so the screen can show it (e.g. "Listening…"). */
  onListeningChange?: (listening: boolean) => void;
}) {
  const snackbar = useSnackbar(); // fallback when the screen doesn't handle voice problems itself (alerts don't show on web)
  const [listening, setListeningState] = useState(false);
  const setListening = useCallback((v: boolean) => { setListeningState(v); onListeningChange?.(v); }, [onListeningChange]);
  const started = useRef(false);

  const denied = useCallback(() => {
    setListening(false);
    if (onPermissionDenied) onPermissionDenied();
    else snackbar({ message: 'Allow microphone and speech recognition to speak your food.' });
  }, [onPermissionDenied, setListening, snackbar]);

  useSpeechRecognitionEvent('start', () => setListening(true));
  useSpeechRecognitionEvent('end', () => setListening(false));
  useSpeechRecognitionEvent('result', (event) => {
    const text = event.results[0]?.transcript ?? '';
    if (event.isFinal) onFinal(text);
    else onText(text);
  });
  useSpeechRecognitionEvent('error', (event) => {
    setListening(false);
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') return denied();
    if (event.error === 'no-speech' || event.error === 'aborted') return;
    const reason =
      event.error === 'audio-capture' ? 'No microphone was found.' :
      event.error === 'network' ? 'Voice input needs an internet connection right now.' :
      event.error === 'language-not-supported' ? 'Voice input isn’t available for this language on your device.' :
      event.message || 'Voice input isn’t available right now.';
    if (onUnavailable) onUnavailable(reason);
    else snackbar({ message: reason });
  });

  const start = useCallback(async () => {
    try {
      const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!permission.granted) return denied();
      ExpoSpeechRecognitionModule.start({
        lang: 'en-US',
        interimResults: true,
        continuous: false,
        // Food words the recognizer might otherwise mishear.
        contextualStrings: ['grams', 'ounces', 'tablespoon', 'teaspoon', 'Greek yogurt', 'oatmeal', 'quinoa', 'edamame'],
      });
    } catch {
      // No speech engine at all (e.g. some browsers): not a permission problem.
      if (onUnavailable) onUnavailable('Voice input isn’t supported here.');
      else denied();
    }
  }, [denied, onUnavailable]);

  useEffect(() => {
    if (autoStart && !started.current) {
      started.current = true;
      start();
    }
  }, [autoStart, start]);

  const toggle = () => (listening ? ExpoSpeechRecognitionModule.stop() : start());

  return (
    <Pressable onPress={toggle} accessibilityRole="button" accessibilityLabel={listening ? 'Stop listening' : 'Speak'}
      accessibilityState={{ busy: listening }} style={[styles.mic, listening && styles.micOn]}>
      {listening ? <Square size={18} color={colors.primaryText} fill={colors.primaryText} /> : <Mic size={22} color={colors.text} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  mic: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceMuted, borderWidth: 1, borderColor: colors.border },
  micOn: { backgroundColor: colors.primary, borderColor: colors.primary },
});
