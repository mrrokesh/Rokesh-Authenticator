import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../lib/auth';

export function Layout() {
  const { user, logout } = useAuth();
  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="logo">MR</span> ROKESH Authenticator <span className="tag">Admin</span>
        </div>
        <nav>
          <NavLink to="/employees">Employees</NavLink>
          <NavLink to="/devices">Devices</NavLink>
          <NavLink to="/audit-logs">Audit log</NavLink>
        </nav>
        <div className="who">
          <span className="muted">{user?.email}</span>
          <button className="ghost" onClick={logout}>Sign out</button>
        </div>
      </header>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}

export function ErrorBanner({ error }: { error: string | null }) {
  if (!error) return null;
  return <div className="error" role="alert">{error}</div>;
}

export const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—');
