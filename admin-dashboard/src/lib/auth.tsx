import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError, refreshSession, setAccessToken, setSessionLostHandler, type User } from './api';

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setSessionLostHandler(() => setUser(null));
    // Resume a session from the httpOnly refresh cookie, if any.
    (async () => {
      try {
        if (await refreshSession()) {
          const { user } = await api<{ user: User }>('/api/auth/me');
          setUser(user);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api<{ accessToken: string; user: User }>('/api/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    if (res.user.role !== 'ADMIN') {
      await api('/api/auth/logout', { method: 'POST' });
      throw new ApiError(403, 'FORBIDDEN', 'This dashboard is for administrators only');
    }
    setAccessToken(res.accessToken);
    const { user } = await api<{ user: User }>('/api/auth/me');
    setUser(user);
  }, []);

  const logout = useCallback(async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    setAccessToken(null);
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, loading, login, logout }), [user, loading, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
