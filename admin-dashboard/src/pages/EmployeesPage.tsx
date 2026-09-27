import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, type Employee, type Role } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ErrorBanner, fmt } from '../components/Layout';

export function EmployeesPage() {
  const { user } = useAuth();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    try {
      const q = search ? `?search=${encodeURIComponent(search)}` : '';
      const res = await api<{ employees: Employee[] }>(`/api/admin/employees${q}`);
      setEmployees(res.employees);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [search]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  async function update(id: string, body: Record<string, unknown>, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    try {
      await api(`/api/admin/employees/${id}`, { method: 'PATCH', body });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const isLocked = (e: Employee) => !!e.lockedUntil && new Date(e.lockedUntil) > new Date();

  return (
    <section>
      <div className="row between">
        <h2>Employees</h2>
        <div className="row">
          <input placeholder="Search name or email" value={search} onChange={(e) => setSearch(e.target.value)} />
          <button onClick={() => setShowCreate((v) => !v)}>{showCreate ? 'Close' : 'Add employee'}</button>
        </div>
      </div>
      <ErrorBanner error={error} />
      {showCreate && (
        <CreateEmployee
          onCreated={async () => {
            setShowCreate(false);
            await load();
          }}
        />
      )}
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Role</th>
            <th>Status</th>
            <th>Devices</th>
            <th>Created</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {employees.map((e) => (
            <tr key={e.id}>
              <td>{e.name}</td>
              <td>{e.email}</td>
              <td><span className={`pill ${e.role === 'ADMIN' ? 'blue' : ''}`}>{e.role}</span></td>
              <td>
                {!e.active ? <span className="pill red">Disabled</span> : isLocked(e) ? <span className="pill amber">Locked</span> : <span className="pill green">Active</span>}
              </td>
              <td>{e.activeDevices}</td>
              <td>{fmt(e.createdAt)}</td>
              <td className="actions">
                {e.active && <Link className="button small" to={`/enroll/${e.id}`}>Enroll device</Link>}
                {isLocked(e) && <button className="small ghost" onClick={() => update(e.id, { unlock: true })}>Unlock</button>}
                {e.id !== user?.id &&
                  (e.active ? (
                    <button className="small danger" onClick={() => update(e.id, { active: false }, `Deactivate ${e.email}? They will be signed out and their devices will stop working.`)}>
                      Deactivate
                    </button>
                  ) : (
                    <button className="small ghost" onClick={() => update(e.id, { active: true })}>Reactivate</button>
                  ))}
              </td>
            </tr>
          ))}
          {employees.length === 0 && (
            <tr>
              <td colSpan={7} className="muted">No employees found.</td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

function CreateEmployee({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('EMPLOYEE');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/api/admin/employees', {
        method: 'POST',
        body: { name, email, role, ...(password ? { password } : {}) },
      });
      onCreated();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card grid" onSubmit={submit}>
      <ErrorBanner error={error} />
      <label>Name<input value={name} onChange={(e) => setName(e.target.value)} required /></label>
      <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
      <label>
        Role
        <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
          <option value="EMPLOYEE">Employee</option>
          <option value="ADMIN">Admin</option>
        </select>
      </label>
      <label>
        Dashboard password {role === 'EMPLOYEE' && <span className="muted">(optional)</span>}
        <input type="password" autoComplete="new-password" minLength={12} value={password} onChange={(e) => setPassword(e.target.value)} required={role === 'ADMIN'} />
      </label>
      <button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create employee'}</button>
    </form>
  );
}
