import { clearAuth, getAccessToken } from './authStorage';

/**
 * In Vite dev, use same-origin `/api` (proxied to uvicorn).
 * In production builds, call the API host directly.
 */
export const API_BASE =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ||
  (import.meta.env.DEV ? '' : 'http://127.0.0.1:8000');

export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const headers = new Headers(options.headers);
  const token = getAccessToken();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (response.status === 401 && getAccessToken()) {
    clearAuth();
    window.location.reload();
  }

  return response;
}
