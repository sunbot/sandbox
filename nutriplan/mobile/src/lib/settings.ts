import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

/** Where the Intake Grid API runs. (Sign-in is handled by src/auth; no secrets are kept here.) */
export type Settings = { apiUrl: string };

const KEY = 'nutriplan.settings';

/**
 * Default server:
 *  - EXPO_PUBLIC_API_URL if set at build time (e.g. your hosted URL baked into the Android APK),
 *  - on the web, the site the app was loaded from (the API serves the web app, so they share an origin),
 *  - otherwise the Android emulator's alias for your PC (10.0.2.2).
 */
const webOrigin = Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.origin : undefined;
export const defaultSettings: Settings = {
  apiUrl: process.env.EXPO_PUBLIC_API_URL || webOrigin || 'http://10.0.2.2:5154',
};

let cached: Settings | null = null;

export async function loadSettings(): Promise<Settings> {
  if (cached) return cached;
  const raw = await AsyncStorage.getItem(KEY);
  const stored = raw ? JSON.parse(raw) : {};
  cached = { apiUrl: typeof stored.apiUrl === 'string' && stored.apiUrl ? stored.apiUrl : defaultSettings.apiUrl };
  // Older versions kept a shared API key here. Sign-in replaced it: remove it from storage.
  if ('apiKey' in stored) await AsyncStorage.setItem(KEY, JSON.stringify(cached));
  return cached!;
}

export async function saveSettings(settings: Settings): Promise<void> {
  cached = { ...settings, apiUrl: settings.apiUrl.trim().replace(/\/+$/, '') };
  await AsyncStorage.setItem(KEY, JSON.stringify(cached));
}
