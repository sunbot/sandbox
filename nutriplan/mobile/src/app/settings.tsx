import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { get } from '@/api/client';
import { Button, Card, Field } from '@/components/ui';
import { loadSettings, saveSettings } from '@/lib/settings';
import { font, spacing } from '@/lib/theme';

/** Where the app finds your NutriPlan server. */
export default function SettingsScreen() {
  const [apiUrl, setApiUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [testing, setTesting] = useState(false);
  const qc = useQueryClient();

  useEffect(() => {
    loadSettings().then((s) => { setApiUrl(s.apiUrl); setApiKey(s.apiKey); });
  }, []);

  const save = async () => {
    await saveSettings({ apiUrl, apiKey });
    setTesting(true);
    try {
      const status = await get<{ languageModel: boolean; foods: number }>('/status');
      Alert.alert('Connected', `${status.foods.toLocaleString()} foods in the database.\nClaude: ${status.languageModel ? 'on' : 'off (offline parsing)'}`);
      qc.invalidateQueries();
    } catch (e) {
      Alert.alert('Saved, but could not connect', e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Card style={{ gap: spacing.md }}>
        <Field label="Server URL" value={apiUrl} onChangeText={setApiUrl} autoCapitalize="none" keyboardType="url" placeholder="http://192.168.1.20:5154" />
        <Field label="API key (if the server has one)" value={apiKey} onChangeText={setApiKey} autoCapitalize="none" secureTextEntry />
        <Button title="Save & test" onPress={save} loading={testing} />
      </Card>
      <Text style={font.small}>
        Android emulator: http://10.0.2.2:5154 · Phone on the same Wi-Fi: http://&lt;your PC’s IP&gt;:5154 · Hosted: your https URL.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({ page: { padding: spacing.lg, gap: spacing.md } });
