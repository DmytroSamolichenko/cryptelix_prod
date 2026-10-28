/**
 * 4.7: the access token lives ONLY in memory (never localStorage) to remove the
 * XSS token-exfiltration surface. Session continuity across reloads comes from
 * the httpOnly refresh cookie via /auth/refresh (see apiClient bootstrap).
 */

export interface AuthUser {
  id: number;
  email: string;
  username?: string | null;
  signedInAt: string;
}

/** @deprecated Use AuthUser */
export type MockUser = AuthUser;

export interface AuthSession {
  accessToken: string;
  csrfToken?: string;
  user: AuthUser;
}

let accessToken: string | null = null;
let csrfToken: string | null = null;

export function isValidEmail(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function getCsrfToken(): string | null {
  return csrfToken;
}

/** Store the in-memory session tokens returned by login/activate/refresh. */
export function setSessionTokens(access: string, csrf?: string | null): void {
  accessToken = access || null;
  if (csrf !== undefined) csrfToken = csrf ?? null;
}

/** Clear all in-memory auth state. */
export function clearAuth(): void {
  accessToken = null;
  csrfToken = null;
}

export function displayNameFromEmail(email: string): string {
  const local = email.split('@')[0]?.trim();
  if (!local) return 'User';
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function formatMemberSince(isoDate: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(
      new Date(isoDate)
    );
  } catch {
    return 'Recently';
  }
}
