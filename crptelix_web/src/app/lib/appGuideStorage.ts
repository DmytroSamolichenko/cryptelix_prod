const storageKey = (userId: number) => `cryptelix-app-guide-seen-${userId}`;

export function hasSeenAppGuide(userId: number): boolean {
  try {
    return localStorage.getItem(storageKey(userId)) === '1';
  } catch {
    return false;
  }
}

export function markAppGuideSeen(userId: number): void {
  try {
    localStorage.setItem(storageKey(userId), '1');
  } catch {
    // ignore quota / private mode
  }
}
