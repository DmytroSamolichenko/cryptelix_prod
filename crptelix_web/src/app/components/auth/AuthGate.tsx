import { useEffect, useState, type ReactNode } from 'react';
import { LoginScreen } from './LoginScreen';
import {
  clearAuth,
  loadAuth,
  saveAuth,
  type AuthSession,
  type AuthUser,
} from '../../lib/authStorage';
import { apiFetch } from '../../lib/apiClient';

interface AuthGateProps {
  children: (user: AuthUser, logout: () => void) => ReactNode;
}

export function AuthGate({ children }: AuthGateProps) {
  const [session, setSession] = useState<AuthSession | null>(() => loadAuth());
  const [bootstrapping, setBootstrapping] = useState(() => loadAuth() !== null);

  useEffect(() => {
    const existing = loadAuth();
    if (!existing?.accessToken) {
      setBootstrapping(false);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch('/api/v1/auth/me');
        if (!res.ok) {
          clearAuth();
          if (!cancelled) setSession(null);
          return;
        }
        const me = (await res.json()) as { id: number; email: string; username?: string | null };
        if (cancelled) return;
        const next = saveAuth({
          accessToken: existing.accessToken,
          user: {
            id: me.id,
            email: me.email,
            username: me.username ?? null,
            signedInAt: existing.user.signedInAt,
          },
        });
        setSession({ accessToken: existing.accessToken, user: next });
      } catch {
        if (!cancelled) {
          clearAuth();
          setSession(null);
        }
      } finally {
        if (!cancelled) setBootstrapping(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const logout = () => {
    // Best-effort server-side session revocation (bumps token_version).
    // Token is read by apiFetch before we clear it locally below.
    void apiFetch('/api/v1/auth/logout', { method: 'POST' }).catch(() => {});
    clearAuth();
    setSession(null);
  };

  if (bootstrapping) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 text-sm text-zinc-400">
        Loading session…
      </div>
    );
  }

  if (!session) {
    return (
      <LoginScreen
        onSuccess={(nextSession) => {
          const user = saveAuth(nextSession);
          setSession({ accessToken: nextSession.accessToken, user });
        }}
      />
    );
  }

  return <>{children(session.user, logout)}</>;
}
