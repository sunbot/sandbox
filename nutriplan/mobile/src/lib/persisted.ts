import { useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * useState that survives app restarts (AsyncStorage on Android, localStorage on web). For small UI state only,
 * such as grocery check-offs — never credentials or nutrition data.
 */
export function usePersistedState<T>(key: string, initial: T): [T, (update: (prev: T) => T) => void, boolean] {
  const [value, setValue] = useState<T>(initial);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const keyRef = useRef(key);
  useEffect(() => {
    keyRef.current = key;
    let alive = true;
    AsyncStorage.getItem(key)
      .then((raw) => { if (alive) { setValue((raw ? (JSON.parse(raw) as T | null) : null) ?? initial); setLoadedKey(key); } })
      .catch(() => { if (alive) { setValue(initial); setLoadedKey(key); } });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `initial` is a default, not a dependency
  }, [key]);
  const update = (fn: (prev: T) => T) =>
    setValue((prev) => {
      const next = fn(prev);
      AsyncStorage.setItem(keyRef.current, JSON.stringify(next)).catch(() => undefined);
      return next;
    });
  return [value, update, loadedKey === key];
}
