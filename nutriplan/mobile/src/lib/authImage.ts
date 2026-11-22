import { useEffect, useState } from 'react';
import { Platform, type ImageSourcePropType } from 'react-native';
import { useAuth } from '@/auth/AuthProvider';
import { loadSettings } from '@/lib/settings';

/**
 * An image source for a URL that needs the signed-in user's token. Android/iOS send `headers` with the image request
 * themselves, but react-native-web's Image ignores them, so on the web the photo is fetched with the token and shown
 * from a temporary object URL (revoked when no longer needed). Returns null while loading or after a failure.
 */
export function useAuthedImage(uri: string | null, headers?: Record<string, string>): ImageSourcePropType | null {
  const needsFetch = Platform.OS === 'web' && !!uri && !!headers && Object.keys(headers).length > 0;
  const headerKey = headers ? JSON.stringify(headers) : '';
  const [objectUrl, setObjectUrl] = useState<{ for: string; url: string | null } | null>(null);

  useEffect(() => {
    if (!needsFetch || !uri) return;
    let url: string | null = null;
    let cancelled = false;
    fetch(uri, { headers: JSON.parse(headerKey) as Record<string, string> })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then((blob) => {
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setObjectUrl({ for: uri, url });
      })
      .catch(() => { if (!cancelled) setObjectUrl({ for: uri, url: null }); });
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [needsFetch, uri, headerKey]);

  if (!uri) return null;
  if (!needsFetch) return headers && Object.keys(headers).length ? { uri, headers } : { uri };
  return objectUrl?.for === uri && objectUrl.url ? { uri: objectUrl.url } : null;
}

/** Where the API is and the bearer header for the signed-in user (for image requests outside the API client). */
export type ServerAuth = { apiUrl: string; token: string | null };

/** The URL and auth header for a recipe's stored photo, or its imported image URL. */
export function recipeImage(r: { id: string; hasPhoto: boolean; imageUrl?: string | null }, server: ServerAuth): { uri: string | null; headers?: Record<string, string> } {
  if (r.hasPhoto) return { uri: `${server.apiUrl}/api/recipes/${r.id}/photo`, headers: server.token ? { Authorization: `Bearer ${server.token}` } : undefined };
  return { uri: r.imageUrl ?? null };
}

/** The server address and the current token; the token updates when Firebase refreshes it. */
export function useServerAuth(): ServerAuth {
  const { token } = useAuth();
  const [apiUrl, setApiUrl] = useState('');
  useEffect(() => { loadSettings().then((s) => setApiUrl(s.apiUrl)); }, []);
  return { apiUrl, token };
}
