import AsyncStorage from '@react-native-async-storage/async-storage';

/** Where the NutriPlan API runs and the optional shared key (Api:Key on the server). */
export type Settings = { apiUrl: string; apiKey: string };

const KEY = 'nutriplan.settings';

/** Android emulator reaches the host machine at 10.0.2.2. On a phone, use your PC's LAN IP or hosted URL. */
export const defaultSettings: Settings = { apiUrl: 'http://10.0.2.2:5154', apiKey: '' };

let cached: Settings | null = null;

export async function loadSettings(): Promise<Settings> {
  if (cached) return cached;
  const raw = await AsyncStorage.getItem(KEY);
  cached = raw ? { ...defaultSettings, ...JSON.parse(raw) } : defaultSettings;
  return cached!;
}

export async function saveSettings(settings: Settings): Promise<void> {
  cached = { ...settings, apiUrl: settings.apiUrl.trim().replace(/\/+$/, '') };
  await AsyncStorage.setItem(KEY, JSON.stringify(cached));
}
