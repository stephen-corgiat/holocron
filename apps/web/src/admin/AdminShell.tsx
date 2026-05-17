import { ReactNode } from 'react';
import { NavLink, type NavLinkRenderProps } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';

export type AdminNavId =
  | 'tasks'
  | 'goals'
  | 'pending'
  | 'cashout'
  | 'ledger'
  | 'restrictions'
  | 'presence'
  | 'users'
  | 'settings';

interface NavSpec {
  id: AdminNavId;
  to: string;
  label: string;
  badge?: number;
  disabled?: boolean;
}

const MANAGE_NAV: NavSpec[] = [
  { id: 'tasks', to: '/admin/tasks', label: 'Tasks' },
  { id: 'goals', to: '/admin/goals', label: 'Goals' },
  { id: 'pending', to: '/admin/pending', label: 'Pending review' },
  { id: 'cashout', to: '/admin/cashout', label: 'Cash-out queue' },
  { id: 'ledger', to: '/admin/ledger', label: 'Ledger' },
  { id: 'restrictions', to: '/admin/restrictions', label: 'Restrictions' },
  { id: 'presence', to: '/admin/presence', label: 'Presence' },
];

const SYSTEM_NAV: NavSpec[] = [
  { id: 'users', to: '/admin/users', label: 'Users' },
  { id: 'settings', to: '/admin/settings', label: 'Settings' },
];

interface Props {
  active: AdminNavId;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}

export function AdminShell({ active, title, subtitle, actions, children }: Props) {
  const { session, logout } = useAuth();
  if (session.kind !== 'admin') return null;

  return (
    <div className="admin-shell-v2">
      <aside className="admin-sidebar">
        <div className="admin-sidebar-brand">
          <span className="wordmark">HOLOCRON</span>
          <span className="admin-sidebar-tagline">Admin console · v1</span>
        </div>

        <nav className="admin-sidebar-nav">
          <div className="admin-nav-label">Manage</div>
          {MANAGE_NAV.map((item) => (
            <AdminNavItem key={item.id} item={item} active={active} />
          ))}

          <div className="admin-nav-label">System</div>
          {SYSTEM_NAV.map((item) => (
            <AdminNavItem key={item.id} item={item} active={active} />
          ))}
        </nav>

        <div className="admin-sidebar-user">
          <div className="admin-sidebar-user-row">
            <div className="admin-sidebar-avatar">
              {session.user.display_name.slice(0, 1).toUpperCase()}
            </div>
            <div className="admin-sidebar-user-meta">
              <div className="admin-sidebar-user-name">{session.user.display_name}</div>
              <div className="admin-sidebar-user-role">Admin</div>
            </div>
            <button
              type="button"
              className="logout-button"
              onClick={logout}
              aria-label="Sign out"
            >
              Sign out
            </button>
          </div>
        </div>
      </aside>

      <main className="admin-main-v2">
        <header className="admin-content-header">
          <div className="admin-content-titles">
            <h1 className="admin-content-title">{title}</h1>
            {subtitle && (
              <div className="admin-content-subtitle">{subtitle}</div>
            )}
          </div>
          {actions && <div className="admin-content-actions">{actions}</div>}
        </header>
        <div className="admin-content-body">{children}</div>
      </main>
    </div>
  );
}

function AdminNavItem({ item, active }: { item: NavSpec; active: AdminNavId }) {
  const isActive = item.id === active;
  if (item.disabled) {
    return (
      <span
        className={`admin-nav-item is-disabled ${isActive ? 'is-active' : ''}`}
        aria-disabled="true"
        title="Coming soon"
      >
        <span className="admin-nav-item-label">{item.label}</span>
        <span className="admin-nav-soon">Soon</span>
      </span>
    );
  }
  return (
    <NavLink
      to={item.to}
      className={({ isActive: nav }: NavLinkRenderProps) =>
        `admin-nav-item ${nav || isActive ? 'is-active' : ''}`
      }
    >
      <span className="admin-nav-item-label">{item.label}</span>
      {item.badge ? (
        <span className="admin-nav-badge">{item.badge}</span>
      ) : null}
    </NavLink>
  );
}
