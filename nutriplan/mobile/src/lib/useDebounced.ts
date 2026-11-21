import { useEffect, useState } from 'react';

/** The value, once it has stopped changing for `ms` (so remote searches don't fire on every keystroke). */
export function useDebounced<T>(value: T, ms = 500): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return settled;
}
