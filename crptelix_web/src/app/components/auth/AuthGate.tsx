import { useState, type ReactNode } from 'react';
import { LoginScreen } from './LoginScreen';
import { loadMockUser, saveMockUser, clearMockUser, type MockUser } from '../../lib/authStorage';

interface AuthGateProps {
  children: (user: MockUser, logout: () => void) => ReactNode;
}

export function AuthGate({ children }: AuthGateProps) {
  const [user, setUser] = useState<MockUser | null>(() => loadMockUser());

  const logout = () => {
    clearMockUser();
    setUser(null);
  };

  if (!user) {
    return (
      <LoginScreen
        onSuccess={(email) => {
          setUser(saveMockUser(email));
        }}
      />
    );
  }

  return <>{children(user, logout)}</>;
}
