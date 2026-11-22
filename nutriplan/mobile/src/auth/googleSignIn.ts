import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, signOut as fbSignOut, type Auth } from 'firebase/auth';
import { firebaseApp } from './firebaseApp';

/**
 * Web: Firebase's own Google sign-in popup (falls back to a full-page redirect when the browser blocks popups).
 * The session is kept by Firebase in the browser's IndexedDB and refreshed by Firebase.
 * Android uses googleSignIn.native.ts instead.
 */
let auth: Auth | null = null;
export function firebaseAuth(): Auth {
  return (auth ??= getAuth(firebaseApp()));
}

export class SignInCancelled extends Error {}

export async function signInWithGoogle(): Promise<void> {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    await signInWithPopup(firebaseAuth(), provider);
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') throw new SignInCancelled();
    if (code === 'auth/popup-blocked') { await signInWithRedirect(firebaseAuth(), provider); return; }
    throw e;
  }
}

export async function signOutEverywhere(): Promise<void> {
  await fbSignOut(firebaseAuth());
}
