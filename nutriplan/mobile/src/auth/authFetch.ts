import type { AuthBridge } from './bridge';

/**
 * Sends a request with the signed-in user's token in the Authorization header (never the URL). On a 401 it asks
 * Firebase for a fresh token and retries exactly once, so an expired token never loops. The caller reports a second 401.
 */
export async function fetchWithAuth(
  doFetch: (url: string, init: RequestInit) => Promise<Response>,
  auth: Pick<AuthBridge, 'token'> | null,
  url: string,
  init: RequestInit & { headers: Record<string, string> },
): Promise<Response> {
  const send = async (forceRefresh: boolean) => {
    const token = auth ? await auth.token(forceRefresh) : null;
    const headers = { ...init.headers };
    if (token) headers.Authorization = `Bearer ${token}`;
    return doFetch(url, { ...init, headers });
  };
  const first = await send(false);
  return first.status === 401 && auth ? send(true) : first;
}

/** What a change of signed-in account means for cached data and the access check. */
export function accountTransition(previousUid: string | null, nextUid: string | null): { clearCache: boolean; checkAccess: boolean } {
  if (nextUid === previousUid) return { clearCache: false, checkAccess: false }; // e.g. Firebase's hourly token refresh
  return { clearCache: previousUid !== null, checkAccess: nextUid !== null };
}
