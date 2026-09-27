import { useCallback, useEffect, useState } from 'react';
import { api, AUDIT_ACTIONS, type AuditLog } from '../lib/api';
import { ErrorBanner, fmt } from '../components/Layout';

const tone = (action: string) =>
  ['APPROVE', 'ENROLL', 'LOGIN', 'TOTP_VERIFIED'].includes(action)
    ? 'green'
    : ['DENY', 'REVOKE', 'LOCKOUT', 'LOGIN_FAILED', 'TOTP_FAILED', 'RECOVERY_FAILED'].includes(action)
      ? 'red'
      : 'blue';

export function AuditLogsPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [action, setAction] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (after?: string) => {
      try {
        const params = new URLSearchParams({ limit: '50' });
        if (action) params.set('action', action);
        if (after) params.set('cursor', after);
        const res = await api<{ logs: AuditLog[]; nextCursor: string | null }>(`/api/admin/audit-logs?${params}`);
        setLogs((prev) => (after ? [...prev, ...res.logs] : res.logs));
        setCursor(res.nextCursor);
        setError(null);
      } catch (err) {
        setError((err as Error).message);
      }
    },
    [action],
  );

  useEffect(() => {
    load();
  }, [load]);

  return (
    <section>
      <div className="row between">
        <h2>Audit log</h2>
        <div className="row">
          <select value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="">All actions</option>
            {AUDIT_ACTIONS.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
          <button className="ghost" onClick={() => load()}>Refresh</button>
        </div>
      </div>
      <ErrorBanner error={error} />
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>Action</th>
            <th>Employee</th>
            <th>IP</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((l) => (
            <tr key={l.id}>
              <td className="nowrap">{fmt(l.createdAt)}</td>
              <td><span className={`pill ${tone(l.action)}`}>{l.action}</span></td>
              <td>{l.employee.name}<div className="muted small">{l.employee.email}</div></td>
              <td>{l.ipAddress ?? '—'}</td>
              <td className="mono small">{l.metadata ? JSON.stringify(l.metadata) : ''}</td>
            </tr>
          ))}
          {logs.length === 0 && (
            <tr>
              <td colSpan={5} className="muted">No audit entries.</td>
            </tr>
          )}
        </tbody>
      </table>
      {cursor && (
        <p>
          <button className="ghost" onClick={() => load(cursor)}>Load more</button>
        </p>
      )}
    </section>
  );
}
