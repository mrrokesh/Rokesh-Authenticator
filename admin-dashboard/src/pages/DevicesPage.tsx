import { useCallback, useEffect, useState } from 'react';
import { api, type Device } from '../lib/api';
import { ErrorBanner, fmt } from '../components/Layout';

export function DevicesPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [includeRevoked, setIncludeRevoked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api<{ devices: Device[] }>(`/api/admin/devices?includeRevoked=${includeRevoked}`);
      setDevices(res.devices);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [includeRevoked]);

  useEffect(() => {
    load();
  }, [load]);

  async function revoke(d: Device) {
    const reason = window.prompt(
      `Revoke "${d.deviceName ?? 'device'}" for ${d.employee.email}?\nIt will immediately stop approving logins and generating valid codes.\n\nReason (optional):`,
    );
    if (reason === null) return;
    try {
      await api('/api/admin/revoke-device', { method: 'POST', body: { deviceId: d.id, ...(reason ? { reason } : {}) } });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <section>
      <div className="row between">
        <h2>Devices</h2>
        <label className="inline">
          <input type="checkbox" checked={includeRevoked} onChange={(e) => setIncludeRevoked(e.target.checked)} /> Show revoked
        </label>
      </div>
      <ErrorBanner error={error} />
      <table>
        <thead>
          <tr>
            <th>Employee</th>
            <th>Device</th>
            <th>Key</th>
            <th>Push</th>
            <th>Recovery codes left</th>
            <th>Enrolled</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {devices.map((d) => (
            <tr key={d.id}>
              <td>{d.employee.name}<div className="muted small">{d.employee.email}</div></td>
              <td>{d.deviceName ?? '—'}</td>
              <td>{d.keyAlgorithm}</td>
              <td>{d.pushRegistered ? <span className="pill green">{d.pushPlatform?.toUpperCase()}</span> : <span className="pill amber">None</span>}</td>
              <td>{d.unusedRecoveryCodes}</td>
              <td>{fmt(d.createdAt)}</td>
              <td>{d.revoked ? <span className="pill red">Revoked {fmt(d.revokedAt)}</span> : <span className="pill green">Active</span>}</td>
              <td className="actions">
                {!d.revoked && <button className="small danger" onClick={() => revoke(d)}>Revoke</button>}
              </td>
            </tr>
          ))}
          {devices.length === 0 && (
            <tr>
              <td colSpan={8} className="muted">No devices.</td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
