/**
 * Firebase web-app settings. These are public identifiers (they ship inside every web page and APK that uses
 * Firebase), not secrets: access is decided by the API checking the signed ID token and the invitation list.
 * Set them at build time as EXPO_PUBLIC_FIREBASE_* (see docs/AUTH.md). Never put a secret in an EXPO_PUBLIC_ variable.
 */
export const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY ?? '',
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ?? '',
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? '',
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID ?? '',
};

/** The Google OAuth "Web client" id of the Firebase project; Android's Credential Manager asks Google for a token for it. */
export const googleWebClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '';

export const signInConfigured = !!(firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.projectId && firebaseConfig.appId);
