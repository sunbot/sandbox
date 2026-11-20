import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text } from 'react-native';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { colors } from '@/lib/theme';

/**
 * Hold-free voice input: tap to talk, tap again (or pause) to stop. Uses the phone's own speech
 * recognizer (on-device where available), so it's free and private. Emits interim + final text.
 */
export function VoiceButton({ onText, onFinal }: { onText: (text: string) => void; onFinal: (text: string) => void }) {
  const [listening, setListening] = useState(false);

  useSpeechRecognitionEvent('start', () => setListening(true));
  useSpeechRecognitionEvent('end', () => setListening(false));
  useSpeechRecognitionEvent('result', (event) => {
    const text = event.results[0]?.transcript ?? '';
    if (event.isFinal) onFinal(text);
    else onText(text);
  });
  useSpeechRecognitionEvent('error', (event) => {
    setListening(false);
    if (event.error !== 'no-speech' && event.error !== 'aborted') Alert.alert('Voice input', event.message || String(event.error));
  });

  const toggle = async () => {
    if (listening) {
      ExpoSpeechRecognitionModule.stop();
      return;
    }
    const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Microphone needed', 'Allow microphone and speech recognition to speak your food.');
      return;
    }
    ExpoSpeechRecognitionModule.start({
      lang: 'en-US',
      interimResults: true,
      continuous: false,
      // Food words the recognizer might otherwise mishear.
      contextualStrings: ['grams', 'ounces', 'tablespoon', 'teaspoon', 'Greek yogurt', 'oatmeal', 'quinoa', 'edamame'],
    });
  };

  return (
    <Pressable onPress={toggle} accessibilityLabel={listening ? 'Stop listening' : 'Speak'} style={[styles.mic, listening && styles.micOn]}>
      <Text style={[styles.icon, listening && { color: '#fff' }]}>{listening ? '■' : '🎤'}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  mic: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceMuted, borderWidth: 1, borderColor: colors.border },
  micOn: { backgroundColor: colors.high, borderColor: colors.high },
  icon: { fontSize: 20 },
});
