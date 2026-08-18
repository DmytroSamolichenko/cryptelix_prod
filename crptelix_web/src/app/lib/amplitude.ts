type AmplitudeClient = {
  setUserId?: (userId: string | undefined) => void;
  reset?: () => void;
};

declare global {
  interface Window {
    amplitude?: AmplitudeClient;
  }
}

function client(): AmplitudeClient | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.amplitude;
}

export function identifyAmplitudeUser(user: { id: number; email?: string | null }) {
  const amplitude = client();
  if (!amplitude?.setUserId) return;
  amplitude.setUserId(String(user.id));
}

export function resetAmplitudeUser() {
  client()?.reset?.();
}
