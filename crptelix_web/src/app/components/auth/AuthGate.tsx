import { useEffect, useState, type ReactNode } from 'react';
import { LoginScreen } from './LoginScreen';
import {
  clearAuth,
  setSessionTokens,
  type AuthSession,
  type AuthUser,
} from '../../lib/authStorage';
import { apiFetch, apiLogout, refreshSession } from '../../lib/apiClient';
import { identifyAmplitudeUser, resetAmplitudeUser } from '../../lib/amplitude';

interface AuthGateProps {
  children: (user: AuthUser, logout: () => void) => ReactNode;
}

export function AuthGate({ children }: AuthGateProps) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [bootstrapping, setBootstrapping] = useState(true);

  // On load the access token is gone (memory-only). Restore the session from
  // the httpOnly refresh cookie, then fetch the profile.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const restored = await refreshSession();
        if (!restored) return;
        const res = await apiFetch('/api/v1/auth/me');
        if (!res.ok) {
          clearAuth();
          return;
        }
        const me = (await res.json()) as {
          id: number;
          email: string;
          username?: string | null;
        };
        if (cancelled) return;
        setUser({
          id: me.id,
          email: me.email,
          username: me.username ?? null,
          signedInAt: new Date().toISOString(),
        });
      } catch {
        if (!cancelled) clearAuth();
      } finally {
        if (!cancelled) setBootstrapping(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    identifyAmplitudeUser(user);
  }, [user]);

  const logout = () => {
    // Cookie-authenticated + CSRF-protected server-side revocation.
    void apiLogout();
    resetAmplitudeUser();
    clearAuth();
    setUser(null);
  };

  if (bootstrapping) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 text-sm text-zinc-400">
        Loading session…
      </div>
    );
  }

  if (!user) {
    return (
      <LoginScreen
        onSuccess={(session: AuthSession) => {
          setSessionTokens(session.accessToken, session.csrfToken);
          setUser(session.user);
        }}
      />
    );
  }

  return <>{children(user, logout)}</>;
}
