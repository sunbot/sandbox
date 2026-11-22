import { fetchWithAuth } from '@/auth/authFetch';
import { accessDeniedReasons, authBridge } from '@/auth/bridge';
import { loadSettings } from '@/lib/settings';

export class ApiError extends Error {
  /** `reason` is the server's machine-readable cause when it gives one (e.g. "NotFound", "Timeout"). */
  constructor(message: string, public status: number, public reason?: string) {
    super(message);
  }
}

/**
 * Minimal fetch wrapper: base URL, the signed-in user's ID token as a bearer token, JSON in/out, readable errors.
 * A 401 is retried once with a freshly refreshed token; if that is rejected too, the session ends and the app shows
 * sign-in. Tokens go only in the Authorization header: never in URLs or logs.
 */
export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { apiUrl } = await loadSettings();
  const auth = authBridge();
  const headers: Record<string, string> = { Accept: 'application/json', ...(init.headers as Record<string, string>) };
  let body = init.body;
  if (init.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(init.json);
  }

  let res: Response;
  try {
    res = await fetchWithAuth(fetch, auth, `${apiUrl}/api${path}`, { ...init, headers, body });
  } catch {
    throw new ApiError(`Can't reach the server at ${apiUrl}. Check your connection.`, 0);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: any;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    // Not JSON: typically a proxy page (too large, timed out, bad gateway) rather than our API.
    if (res.status === 413) throw new ApiError('That file is too large for the server.', 413);
    if (res.status === 502 || res.status === 503 || res.status === 504) throw new ApiError('The server took too long or is restarting. Wait a minute and try again.', res.status);
    if (!res.ok) throw new ApiError(`Request failed (${res.status})`, res.status);
    throw new ApiError('The server sent a response the app could not read.', res.status);
  }
  const reason = typeof data?.reason === 'string' ? data.reason : undefined;
  if (res.status === 401) {
    auth?.sessionEnded(reason);
    throw new ApiError(data?.title ?? 'Sign in to continue.', 401, reason);
  }
  if (res.status === 403 && reason && accessDeniedReasons.has(reason)) auth?.accessDenied(reason);
  if (!res.ok) throw new ApiError(data?.detail ?? data?.title ?? `Request failed (${res.status})`, res.status, reason);
  return data as T;
}

export const get = <T>(path: string) => api<T>(path);
export const post = <T>(path: string, json?: unknown, headers?: Record<string, string>) => api<T>(path, { method: 'POST', json: json ?? {}, headers });
export const put = <T>(path: string, json: unknown) => api<T>(path, { method: 'PUT', json });
export const patch = <T>(path: string, json: unknown) => api<T>(path, { method: 'PATCH', json });
export const del = (path: string) => api<void>(path, { method: 'DELETE' });

export const q = (params: Record<string, string | number | boolean | undefined | null>) =>
  Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
