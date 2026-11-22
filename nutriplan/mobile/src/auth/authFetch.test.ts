/** The app's token handling: header only, one refresh-and-retry on 401, and cache clearing on account changes. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { accountTransition, fetchWithAuth } from './authFetch.ts';

const res = (status: number) => new Response(status === 204 ? null : '{}', { status });

function fakeAuth(tokens: string[]) {
  const calls: boolean[] = [];
  return { calls, token: async (force: boolean) => { calls.push(force); return tokens[calls.length - 1] ?? null; } };
}

test('sends the token as a bearer header, never in the URL', async () => {
  const seen: { url: string; init: RequestInit }[] = [];
  await fetchWithAuth(async (url, init) => { seen.push({ url, init }); return res(200); }, fakeAuth(['tok-1']), 'https://x/api/diary', { headers: {} });
  assert.equal((seen[0].init.headers as Record<string, string>).Authorization, 'Bearer tok-1');
  assert.ok(!seen[0].url.includes('tok-1'));
});

test('an expired token is refreshed once and the request retried', async () => {
  const auth = fakeAuth(['old', 'fresh']);
  const statuses = [401, 200];
  const sent: string[] = [];
  const r = await fetchWithAuth(async (_u, init) => { sent.push((init.headers as Record<string, string>).Authorization); return res(statuses.shift()!); }, auth, 'u', { headers: {} });
  assert.equal(r.status, 200);
  assert.deepEqual(auth.calls, [false, true]);
  assert.deepEqual(sent, ['Bearer old', 'Bearer fresh']);
});

test('a refresh that is also rejected is not retried again (no loop)', async () => {
  const auth = fakeAuth(['old', 'fresh', 'again']);
  let n = 0;
  const r = await fetchWithAuth(async () => { n++; return res(401); }, auth, 'u', { headers: {} });
  assert.equal(r.status, 401);
  assert.equal(n, 2);
});

test('signed out: no Authorization header and no retry', async () => {
  let n = 0;
  const r = await fetchWithAuth(async (_u, init) => { n++; assert.equal((init.headers as Record<string, string>).Authorization, undefined); return res(401); }, null, 'u', { headers: {} });
  assert.equal(r.status, 401);
  assert.equal(n, 1);
});

test('switching accounts clears cached data; a token refresh for the same account does not', () => {
  assert.deepEqual(accountTransition(null, 'a'), { clearCache: false, checkAccess: true });   // first sign-in (cache already empty)
  assert.deepEqual(accountTransition('a', 'a'), { clearCache: false, checkAccess: false });  // hourly token refresh
  assert.deepEqual(accountTransition('a', 'b'), { clearCache: true, checkAccess: true });    // different account
  assert.deepEqual(accountTransition('a', null), { clearCache: true, checkAccess: false });   // signed out
});
