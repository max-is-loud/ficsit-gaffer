// Authentication client. Wraps the Better Auth React client (cookie-based
// sessions — no token is stored in localStorage) behind small async helpers the
// foreman hook can call. Same-origin: the dev server and the production nginx
// image both proxy /api to the backend, so the default base URL is correct.

import { twoFactorClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient({
  plugins: [twoFactorClient()],
});

/** The authenticated user, as the UI needs it. */
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  /** Whether the account has MFA (two-factor) enabled. */
  twoFactorEnabled: boolean;
}

function toAuthUser(user: {
  id: string;
  email: string;
  name: string;
  twoFactorEnabled?: boolean | null;
}): AuthUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    twoFactorEnabled: user.twoFactorEnabled === true,
  };
}

/**
 * Outcome of a sign-in attempt: either a full session, or a pending state where
 * the account has MFA enabled and a second factor is still required.
 */
export type SignInResult = { kind: 'authed'; user: AuthUser } | { kind: 'twoFactor' };

function messageOf(error: { message?: string } | null | undefined, fallback: string): string {
  return error?.message !== undefined && error.message.length > 0 ? error.message : fallback;
}

/** Resolves the current user from the session cookie, or null if signed out. */
export async function fetchCurrentUser(): Promise<AuthUser | null> {
  const { data } = await authClient.getSession();
  if (data?.user === undefined || data.user === null) {
    return null;
  }
  return toAuthUser(data.user);
}

/** Creates an account and starts a session. Throws on failure. */
export async function signUp(name: string, email: string, password: string): Promise<AuthUser> {
  const { data, error } = await authClient.signUp.email({ name, email, password });
  if (error !== null || data === null) {
    throw new Error(messageOf(error, 'Could not create the account.'));
  }
  return toAuthUser(data.user);
}

/**
 * Signs in with email + password. When the account has MFA enabled the server
 * withholds the session and asks for a second factor — surfaced as
 * `{ kind: 'twoFactor' }`; the caller then verifies a TOTP or backup code.
 */
export async function signIn(email: string, password: string): Promise<SignInResult> {
  const { data, error } = await authClient.signIn.email({ email, password });
  if (error !== null || data === null) {
    throw new Error(messageOf(error, 'Could not sign in.'));
  }
  if ('twoFactorRedirect' in data && data.twoFactorRedirect === true) {
    return { kind: 'twoFactor' };
  }
  const user = await fetchCurrentUser();
  if (user === null) {
    throw new Error('Signed in, but no session was established.');
  }
  return { kind: 'authed', user };
}

/** Completes a pending MFA sign-in with a TOTP code (optionally trusting the device). */
export async function verifyTotp(code: string, trustDevice: boolean): Promise<AuthUser> {
  const { error } = await authClient.twoFactor.verifyTotp({ code, trustDevice });
  if (error !== null) {
    throw new Error(messageOf(error, 'That code was not accepted.'));
  }
  return resolveUserAfterVerify();
}

/** Completes a pending MFA sign-in with a single-use backup/recovery code. */
export async function verifyBackupCode(code: string, trustDevice: boolean): Promise<AuthUser> {
  const { error } = await authClient.twoFactor.verifyBackupCode({ code, trustDevice });
  if (error !== null) {
    throw new Error(messageOf(error, 'That recovery code was not accepted.'));
  }
  return resolveUserAfterVerify();
}

async function resolveUserAfterVerify(): Promise<AuthUser> {
  const user = await fetchCurrentUser();
  if (user === null) {
    throw new Error('Verified, but no session was established.');
  }
  return user;
}

/** Enrolment data returned when MFA is turned on: the TOTP URI + recovery codes. */
export interface TwoFactorEnrolment {
  totpURI: string;
  backupCodes: string[];
}

/**
 * Begins MFA enrolment (requires the account password). Returns the `otpauth://`
 * TOTP URI (render as a QR / show the secret) and the single-use backup codes.
 * The pioneer must then confirm a TOTP code via {@link verifyTotp} to finish.
 */
export async function enableTwoFactor(password: string): Promise<TwoFactorEnrolment> {
  const { data, error } = await authClient.twoFactor.enable({ password, method: 'totp' });
  if (error !== null || data === null) {
    throw new Error(messageOf(error, 'Could not start two-factor setup.'));
  }
  // Better Auth 1.7 also offers email/SMS 'otp' enrolment, which returns no TOTP
  // URI or backup codes. We always ask for 'totp', so any other answer is an error.
  if (data.method !== 'totp') {
    throw new Error('Two-factor setup did not return an authenticator secret.');
  }
  return { totpURI: data.totpURI, backupCodes: data.backupCodes };
}

/** Turns MFA off (requires the account password). */
export async function disableTwoFactor(password: string): Promise<void> {
  const { error } = await authClient.twoFactor.disable({ password });
  if (error !== null) {
    throw new Error(messageOf(error, 'Could not disable two-factor.'));
  }
}

/** Updates the signed-in user's display name. */
export async function updateDisplayName(name: string): Promise<void> {
  const { error } = await authClient.updateUser({ name });
  if (error !== null) {
    throw new Error(messageOf(error, 'Could not update your name.'));
  }
}

/**
 * Changes the account password (requires the current one). Other sessions are
 * revoked; the current session is re-issued, so the user stays signed in here.
 */
export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const { error } = await authClient.changePassword({
    currentPassword,
    newPassword,
    revokeOtherSessions: true,
  });
  if (error !== null) {
    throw new Error(messageOf(error, 'Could not change your password.'));
  }
}

/** Ends the current session. */
export async function signOut(): Promise<void> {
  await authClient.signOut();
}
