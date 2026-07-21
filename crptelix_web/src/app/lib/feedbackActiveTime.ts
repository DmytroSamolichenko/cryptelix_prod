/** Accumulates milliseconds while the app tab is visible (pauses in background). */

const storageKey = (userId: number) => `cryptelix-feedback-active-ms:${userId}`;

export function loadActiveMs(userId: number): number {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    const n = raw ? Number(raw) : 0;
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

export function saveActiveMs(userId: number, ms: number): void {
  try {
    localStorage.setItem(storageKey(userId), String(Math.max(0, Math.floor(ms))));
  } catch {
    // ignore quota / private mode
  }
}

export function clearActiveMs(userId: number): void {
  try {
    localStorage.removeItem(storageKey(userId));
  } catch {
    // ignore
  }
}
