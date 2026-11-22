import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { onIdTokenChanged, type User } from 'firebase/auth';
import { ApiError, get } from '@/api/client';
import type { Account, AccessState } from '@/api/types';
import { accountTransition } from './authFetch';
import { setAuthBridge } from './bridge';
import { signInConfigured } from './config';
import { firebaseAuth, signInWithGoogle, signOutEverywhere, SignInCancelled } from './googleSignIn';

export type AuthState =
  | { status: 'unconfigured' }
  | { status: 'loading' }
  | { status: 'signedOut'; notice?: string }
  | { status: 'checking' }
  | { status: 'active'; account: Account }
  | { status: 'denied'; reason: Exclude<AccessState, 'Active'>; message: string; subject: string; email: string | null }
  | { status: 'unreachable'; message: string };

type AuthContextValue = {
  state: AuthState;
  /** The current ID token, for image requests that can't go through the API client. Never log or put it in a URL. */
  token: string | null;
  signIn(): Promise<void>;
  signOut(notice?: string): Promise<void>;
  recheck(): Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

/**
 * Owns the sign-in session: restores it at launch (Firebase keeps it in SecureStore / the browser), asks the API
 * whether this account has access, and clears every cached query whenever the signed-in account changes or signs out,
 * so one person's data is never shown to the next.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [state, setState] = useState<AuthState>(signInConfigured ? { status: 'loading' } : { status: 'unconfigured' });
  const [token, setToken] = useState<string | null>(null);
  const userRef = useRef<User | null>(null);
  const lastUid = useRef<string | null>(null);
  const ending = useRef(false);

  const check = useCallback(async () => {
    const user = userRef.current;
    if (!user) return;
    setState({ status: 'checking' });
    try {
      const session = await get<{ state: AccessState; message: string; user: Account | null; subject: string }>('/account/session');
      if (userRef.current?.uid !== user.uid) return; // switched accounts while checking
      if (session.state === 'Active' && session.user) setState({ status: 'active', account: session.user });
      else setState({ status: 'denied', reason: session.state as Exclude<AccessState, 'Active'>, message: session.message, subject: session.subject, email: user.email });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return; // the bridge is ending the session
      setState({ status: 'unreachable', message: e instanceof Error ? e.message : 'Couldn’t reach the server.' });
    }
  }, []);

  const signOut = useCallback(async (notice?: string) => {
    qc.clear();
    lastUid.current = null;
    try { await signOutEverywhere(); } finally { setState({ status: 'signedOut', notice }); }
  }, [qc]);

  useEffect(() => {
    if (!signInConfigured) return;
    setAuthBridge({
      token: async (force) => (userRef.current ? userRef.current.getIdToken(force) : null),
      sessionEnded: () => {
        if (ending.current || !userRef.current) return;
        ending.current = true;
        signOut('Your session ended. Sign in again.').finally(() => { ending.current = false; });
      },
      accessDenied: () => { void check(); },
    });
    // Fires at launch (restored session or none), on sign-in/out, and when Firebase refreshes the hourly ID token.
    const unsubscribe = onIdTokenChanged(firebaseAuth(), async (user) => {
      userRef.current = user;
      if (!user) {
        setToken(null);
        if (lastUid.current) qc.clear();
        lastUid.current = null;
        setState((s) => (s.status === 'signedOut' ? s : { status: 'signedOut' }));
        return;
      }
      setToken(await user.getIdToken());
      const change = accountTransition(lastUid.current, user.uid);
      if (change.clearCache) qc.clear(); // a different account: drop everything cached for the previous one
      lastUid.current = user.uid;
      if (change.checkAccess) await check();
    });
    return () => { unsubscribe(); setAuthBridge(null); };
  }, [qc, check, signOut]);

  const signIn = useCallback(async () => {
    try {
      await signInWithGoogle();
    } catch (e) {
      if (e instanceof SignInCancelled) return;
      throw e;
    }
  }, []);

  const value = useMemo<AuthContextValue>(() => ({ state, token, signIn, signOut, recheck: check }), [state, token, signIn, signOut, check]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
