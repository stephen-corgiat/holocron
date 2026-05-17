import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { authApi, WhoamiResponse } from './api';
import { adminTokenStore, tabletTokenStore } from './session-storage';

export type Session =
  | { kind: 'anonymous' }
  | { kind: 'admin'; token: string; user: NonNullable<Extract<WhoamiResponse, { kind: 'admin' }>['user']> }
  | { kind: 'tablet'; token: string; enrolledBy: string };

interface AuthContextValue {
  session: Session;
  loading: boolean;
  loginAdmin: (username: string, password: string) => Promise<void>;
  installTabletToken: (token: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session>({ kind: 'anonymous' });
  const [loading, setLoading] = useState(true);

  const hydrate = useCallback(async () => {
    setLoading(true);
    try {
      const adminToken = adminTokenStore.get();
      if (adminToken) {
        const me = await authApi.whoami(adminToken).catch(() => null);
        if (me && me.kind === 'admin' && me.user) {
          setSession({ kind: 'admin', token: adminToken, user: me.user });
          return;
        }
        adminTokenStore.clear();
      }
      const tabletToken = tabletTokenStore.get();
      if (tabletToken) {
        const me = await authApi.whoami(tabletToken).catch(() => null);
        if (me && me.kind === 'tablet') {
          setSession({
            kind: 'tablet',
            token: tabletToken,
            enrolledBy: me.enrolled_by,
          });
          return;
        }
        tabletTokenStore.clear();
      }
      setSession({ kind: 'anonymous' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const loginAdmin = useCallback(
    async (username: string, password: string) => {
      const { token, user } = await authApi.loginAdmin(username, password);
      adminTokenStore.set(token);
      // An admin signing in on the wall tablet should not silently
      // re-promote the device — keep the tablet token only after explicit
      // enrollment. Clearing here makes that explicit.
      tabletTokenStore.clear();
      setSession({ kind: 'admin', token, user });
    },
    [],
  );

  const installTabletToken = useCallback(async (token: string) => {
    const me = await authApi.whoami(token);
    if (me.kind !== 'tablet') {
      throw new Error('redeemed token is not a household-tablet token');
    }
    tabletTokenStore.set(token);
    adminTokenStore.clear();
    setSession({
      kind: 'tablet',
      token,
      enrolledBy: me.enrolled_by,
    });
  }, []);

  const logout = useCallback(() => {
    adminTokenStore.clear();
    // Tablet token persists across logout — that's the point.
    setSession((prev) =>
      prev.kind === 'admin' ? { kind: 'anonymous' } : prev,
    );
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ session, loading, loginAdmin, installTabletToken, logout }),
    [session, loading, loginAdmin, installTabletToken, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
