// Google sign-in (OpenID Connect) plus an owner-controlled allowlist.
// Anyone can sign in, but only the owner and people the owner approved get in.

import { OAuth2Client } from 'google-auth-library';

export function makeOAuthClient({ clientId, clientSecret, publicUrl }) {
  return new OAuth2Client(clientId, clientSecret, `${publicUrl}/auth/google/callback`);
}

export function authUrl(client, state) {
  return client.generateAuthUrl({
    access_type: 'online',
    scope: ['openid', 'email', 'profile'],
    prompt: 'select_account',
    state,
  });
}

// Exchange the code for tokens and return the verified Google profile.
export async function verifyGoogleLogin(client, clientId, code) {
  const { tokens } = await client.getToken(code);
  const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: clientId });
  const payload = ticket.getPayload();
  if (!payload.email_verified) throw new Error('Google account email is not verified.');
  return { email: payload.email.toLowerCase(), name: payload.name ?? payload.email, sub: payload.sub };
}

export function accessFor(email, store, ownerEmail) {
  if (email === ownerEmail.toLowerCase()) return 'owner';
  if (store.data.allowed[email]) return 'approved';
  if (store.data.requests[email]) return 'pending';
  return 'none';
}

export function requestAccess(email, name, store, now = new Date().toISOString()) {
  if (!store.data.requests[email]) store.data.requests[email] = { name, requestedAt: now };
  store.save();
}

export function decide(email, decision, store, ownerEmail, now = new Date().toISOString()) {
  const request = store.data.requests[email];
  delete store.data.requests[email];
  if (decision === 'approve') {
    store.data.allowed[email] = { name: request?.name ?? email, approvedAt: now, approvedBy: ownerEmail };
  } else if (decision === 'revoke') {
    delete store.data.allowed[email];
  }
  store.save();
}
