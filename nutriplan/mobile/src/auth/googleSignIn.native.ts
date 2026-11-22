import * as FirebaseAuth from 'firebase/auth';
import { GoogleAuthProvider, initializeAuth, signInWithCredential, signOut as fbSignOut, type Auth, type Persistence } from 'firebase/auth';
import { GoogleOneTapSignIn, isCancelledResponse, isErrorWithCode, isNoSavedCredentialFoundResponse, isSuccessResponse, statusCodes } from 'react-native-nitro-google-signin';
import { googleWebClientId } from './config';
import { firebaseApp } from './firebaseApp';
import { secureStorage } from './secureStorage';

/**
 * Android: Google's Credential Manager (the system account sheet) gives a Google ID token for the Firebase project's
 * web client; Firebase exchanges it for its own session. Firebase keeps that session (including its refresh token) in
 * the device's encrypted SecureStore, not in AsyncStorage, and refreshes the hour-long ID token itself.
 */
// getReactNativePersistence is only in the React Native build's type definitions.
const getReactNativePersistence = (FirebaseAuth as unknown as { getReactNativePersistence: (s: typeof secureStorage) => Persistence }).getReactNativePersistence;

let auth: Auth | null = null;
export function firebaseAuth(): Auth {
  return (auth ??= initializeAuth(firebaseApp(), { persistence: getReactNativePersistence(secureStorage) }));
}

export class SignInCancelled extends Error {}

let configured = false;
function configure() {
  if (configured) return;
  if (!googleWebClientId) throw new Error('Google sign-in isn’t set up in this build (missing web client id).');
  GoogleOneTapSignIn.configure({ webClientId: googleWebClientId });
  configured = true;
}

export async function signInWithGoogle(): Promise<void> {
  configure();
  try {
    await GoogleOneTapSignIn.checkPlayServices();
    let response = await GoogleOneTapSignIn.signIn();
    if (isNoSavedCredentialFoundResponse(response)) response = await GoogleOneTapSignIn.createAccount();
    if (isNoSavedCredentialFoundResponse(response)) response = await GoogleOneTapSignIn.presentExplicitSignIn();
    if (isCancelledResponse(response)) throw new SignInCancelled();
    if (!isSuccessResponse(response) || !response.data.idToken) throw new Error('Google didn’t return a sign-in. Try again.');
    await signInWithCredential(firebaseAuth(), GoogleAuthProvider.credential(response.data.idToken));
  } catch (e) {
    if (e instanceof SignInCancelled) throw e;
    if (isErrorWithCode(e) && e.code === statusCodes.SIGN_IN_CANCELLED) throw new SignInCancelled();
    if (isErrorWithCode(e) && e.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) throw new Error('Google Play services are needed to sign in.');
    throw e;
  }
}

export async function signOutEverywhere(): Promise<void> {
  await fbSignOut(firebaseAuth());
  // Also forget the Google account choice, so the next sign-in can pick a different account.
  try { configure(); await GoogleOneTapSignIn.signOut(); } catch { /* the Firebase session is already gone */ }
}
