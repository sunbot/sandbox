import * as SecureStore from 'expo-secure-store';

/**
 * The storage interface Firebase's React Native persistence expects, backed by SecureStore (Android Keystore-encrypted).
 * SecureStore keys allow only letters, digits, ".", "-" and "_", so Firebase's keys are encoded; long values are split
 * into chunks because some platforms reject large single values.
 */
const CHUNK = 1800;
const safeKey = (key: string) => 'fb_' + key.replace(/[^A-Za-z0-9._-]/g, (c) => '-' + c.charCodeAt(0).toString(16) + '_');

export const secureStorage = {
  async getItem(key: string): Promise<string | null> {
    const k = safeKey(key);
    const count = Number(await SecureStore.getItemAsync(k + '.n'));
    if (!count) return null;
    const parts: string[] = [];
    for (let i = 0; i < count; i++) {
      const part = await SecureStore.getItemAsync(`${k}.${i}`);
      if (part === null) return null;
      parts.push(part);
    }
    return parts.join('');
  },
  async setItem(key: string, value: string): Promise<void> {
    const k = safeKey(key);
    const old = Number(await SecureStore.getItemAsync(k + '.n')) || 0;
    const count = Math.max(1, Math.ceil(value.length / CHUNK));
    for (let i = 0; i < count; i++) await SecureStore.setItemAsync(`${k}.${i}`, value.slice(i * CHUNK, (i + 1) * CHUNK));
    await SecureStore.setItemAsync(k + '.n', String(count));
    for (let i = count; i < old; i++) await SecureStore.deleteItemAsync(`${k}.${i}`);
  },
  async removeItem(key: string): Promise<void> {
    const k = safeKey(key);
    const count = Number(await SecureStore.getItemAsync(k + '.n')) || 0;
    await SecureStore.deleteItemAsync(k + '.n');
    for (let i = 0; i < count; i++) await SecureStore.deleteItemAsync(`${k}.${i}`);
  },
};
