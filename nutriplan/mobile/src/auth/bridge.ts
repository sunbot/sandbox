/**
 * How the API client reaches the signed-in session without importing React or Firebase: the AuthProvider registers
 * these once. Kept tiny so the client stays testable.
 */
export type AuthBridge = {
  /** The current Firebase ID token (refreshed by Firebase when near expiry), or null when signed out. */
  token(forceRefresh: boolean): Promise<string | null>;
  /** The server rejected even a fresh token: end the session and show sign-in. */
  sessionEnded(reason?: string): void;
  /** The server says this account has no access (not invited, turned off, unverified email). */
  accessDenied(reason: string): void;
};

let bridge: AuthBridge | null = null;
export const setAuthBridge = (b: AuthBridge | null) => { bridge = b; };
export const authBridge = () => bridge;

/** Reasons the API gives for an account that is signed in but may not use the app. */
export const accessDeniedReasons = new Set(['NotInvited', 'Revoked', 'EmailNotVerified']);
