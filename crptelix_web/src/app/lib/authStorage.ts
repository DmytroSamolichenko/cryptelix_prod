const STORAGE_KEY = 'cryptelix-mock-auth';

export interface MockUser {
  email: string;
  signedInAt: string;
}

export function isValidEmail(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

export function loadMockUser(): MockUser | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<MockUser>;
    if (!parsed?.email || typeof parsed.email !== 'string') return null;
    return {
      email: parsed.email,
      signedInAt: typeof parsed.signedInAt === 'string' ? parsed.signedInAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function saveMockUser(email: string): MockUser {
  const user: MockUser = {
    email: email.trim().toLowerCase(),
    signedInAt: new Date().toISOString(),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
  return user;
}

export function clearMockUser(): void {
  localStorage.removeItem(STORAGE_KEY);
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
