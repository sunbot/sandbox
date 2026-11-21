import { useEffect, useState } from 'react';
import { Platform, type ImageSourcePropType } from 'react-native';

/**
 * An image source for a URL that may need the app's API key. Android/iOS send `headers` with the image request
 * themselves, but react-native-web's Image ignores them, so on the web the photo is fetched with the key and shown
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

/** The URL and key headers for a recipe's stored photo, or its imported image URL. */
export function recipeImage(r: { id: string; hasPhoto: boolean; imageUrl?: string | null }, server: { apiUrl: string; apiKey: string }): { uri: string | null; headers?: Record<string, string> } {
  if (r.hasPhoto) return { uri: `${server.apiUrl}/api/recipes/${r.id}/photo`, headers: server.apiKey ? { 'X-Api-Key': server.apiKey } : undefined };
  return { uri: r.imageUrl ?? null };
}
