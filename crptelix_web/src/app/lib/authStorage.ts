const STORAGE_KEY = 'cryptelix-auth';

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
  user: AuthUser;
}

interface StoredAuth {
  accessToken: string;
  user: AuthUser;
}

export function isValidEmail(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

export function getAccessToken(): string | null {
  const session = loadAuth();
  return session?.accessToken ?? null;
}

export function loadAuth(): AuthSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredAuth>;
    if (!parsed?.accessToken || !parsed.user?.email || typeof parsed.user.id !== 'number') {
      return null;
    }
    return {
      accessToken: parsed.accessToken,
      user: {
        id: parsed.user.id,
        email: parsed.user.email,
        username: parsed.user.username ?? null,
        signedInAt:
          typeof parsed.user.signedInAt === 'string'
            ? parsed.user.signedInAt
            : new Date().toISOString(),
      },
    };
  } catch {
    return null;
  }
}

export function saveAuth(session: AuthSession): AuthUser {
  const payload: StoredAuth = {
    accessToken: session.accessToken,
    user: {
      ...session.user,
      email: session.user.email.trim().toLowerCase(),
      signedInAt: session.user.signedInAt || new Date().toISOString(),
    },
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  return payload.user;
}

export function clearAuth(): void {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem('cryptelix-mock-auth');
}

/** @deprecated Use loadAuth */
export function loadMockUser(): AuthUser | null {
  return loadAuth()?.user ?? null;
}

/** @deprecated Use saveAuth */
export function saveMockUser(email: string): AuthUser {
  return saveAuth({
    accessToken: '',
    user: {
      id: 0,
      email: email.trim().toLowerCase(),
      signedInAt: new Date().toISOString(),
    },
  });
}

/** @deprecated Use clearAuth */
export function clearMockUser(): void {
  clearAuth();
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
