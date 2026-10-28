import { clearAuth, getAccessToken, getCsrfToken, setSessionTokens } from './authStorage';

/**
 * In Vite dev, use same-origin `/api` (proxied to uvicorn) so cookies are
 * first-party. In production builds, call the API host directly
 * (VITE_API_BASE_URL, e.g. https://api.cryptelix.app) — same site as the
 * frontend so the refresh cookie (SameSite=Lax) is sent with credentials.
 */
export const API_BASE =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ||
  (import.meta.env.DEV ? '' : 'http://127.0.0.1:8000');

const CSRF_COOKIE = 'cryptelix_csrf';
const REFRESH_PATH = '/api/v1/auth/refresh';

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

/** CSRF value for cookie-authenticated calls: cookie is source of truth. */
function csrfHeaderValue(): string | null {
  return readCookie(CSRF_COOKIE) ?? getCsrfToken();
}

interface RefreshResponse {
  access_token: string;
  csrf_token?: string | null;
}

// Single-flight: concurrent 401s share one refresh round-trip.
let refreshPromise: Promise<boolean> | null = null;

/**
 * Exchange the refresh cookie for a new access token. Returns true on success.
 * Used both on 401 retries and on app bootstrap (reload) to restore a session.
 */
export async function refreshSession(): Promise<boolean> {
  const csrf = csrfHeaderValue();
  // No CSRF cookie means there is no active session to refresh.
  if (!csrf) return false;
  try {
    const res = await fetch(`${API_BASE}${REFRESH_PATH}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-CSRF-Token': csrf },
    });
    if (!res.ok) return false;
    const data = (await res.json()) as RefreshResponse;
    setSessionTokens(data.access_token, data.csrf_token);
    return true;
  } catch {
    return false;
  }
}

function runRefresh(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = refreshSession().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const doFetch = () => {
    const headers = new Headers(options.headers);
    const token = getAccessToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    return fetch(`${API_BASE}${path}`, {
      ...options,
      credentials: 'include',
      headers,
    });
  };

  let response = await doFetch();

  // Access token expired → try one refresh, then replay the request once.
  if (response.status === 401) {
    const refreshed = await runRefresh();
    if (refreshed) {
      response = await doFetch();
    } else {
      clearAuth();
    }
  }

  return response;
}

/** Cookie-authenticated, CSRF-protected logout. */
export async function apiLogout(): Promise<void> {
  const csrf = csrfHeaderValue();
  try {
    await fetch(`${API_BASE}/api/v1/auth/logout`, {
      method: 'POST',
      credentials: 'include',
      headers: csrf ? { 'X-CSRF-Token': csrf } : undefined,
    });
  } catch {
    // Best-effort; local state is cleared by the caller regardless.
  }
}
