import { ReactNode } from 'react';
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthProvider';
import { SettingsProvider } from './settings/SettingsProvider';
import { LoginPage } from './pages/LoginPage';
import { TabletEnrollPage } from './pages/TabletEnrollPage';
import { AdminHomePage } from './pages/AdminHomePage';
import { TabletPage } from './pages/TabletPage';

export function App() {
  return (
    <AuthProvider>
      <SettingsProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<AnonOnly><LoginPage /></AnonOnly>} />
          <Route path="/tablet/enroll" element={<AnonOnly><TabletEnrollPage /></AnonOnly>} />
          <Route
            path="/admin/*"
            element={
              <RequireSession kinds={['admin']}>
                <AdminHomePage />
              </RequireSession>
            }
          />
          <Route
            path="/"
            element={
              <RequireSession kinds={['tablet']}>
                <TabletPage />
              </RequireSession>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      </SettingsProvider>
    </AuthProvider>
  );
}

function RequireSession({
  kinds,
  children,
}: {
  kinds: Array<'admin' | 'tablet'>;
  children: ReactNode;
}) {
  const { session, loading } = useAuth();
  const location = useLocation();
  if (loading) return <SplashLoading />;
  if (session.kind === 'anonymous') {
    const fallback = kinds.includes('admin') ? '/login' : '/tablet/enroll';
    return <Navigate to={fallback} replace state={{ from: location }} />;
  }
  if (!kinds.includes(session.kind)) {
    return <Navigate to={session.kind === 'admin' ? '/admin' : '/'} replace />;
  }
  return <>{children}</>;
}

function AnonOnly({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  if (loading) return <SplashLoading />;
  if (session.kind === 'admin') return <Navigate to="/admin" replace />;
  if (session.kind === 'tablet') return <Navigate to="/" replace />;
  return <>{children}</>;
}

function SplashLoading() {
  return (
    <div className="auth-shell">
      <div className="auth-card">
        <span className="wordmark">HOLOCRON</span>
        <p className="auth-prose">Initializing…</p>
      </div>
    </div>
  );
}
