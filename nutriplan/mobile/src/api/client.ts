import { loadSettings } from '@/lib/settings';

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

/** Minimal fetch wrapper: base URL + optional API key from settings, JSON in/out, readable errors. */
export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { apiUrl, apiKey } = await loadSettings();
  const headers: Record<string, string> = { Accept: 'application/json', ...(init.headers as Record<string, string>) };
  if (apiKey) headers['X-Api-Key'] = apiKey;
  let body = init.body;
  if (init.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(init.json);
  }

  let res: Response;
  try {
    res = await fetch(`${apiUrl}/api${path}`, { ...init, headers, body });
  } catch {
    throw new ApiError(`Can't reach the server at ${apiUrl}. Check Settings.`, 0);
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
  if (res.status === 401) throw new ApiError('API key missing or wrong — enter it in More → Settings.', 401);
  if (!res.ok) throw new ApiError(data?.detail ?? data?.title ?? `Request failed (${res.status})`, res.status);
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
