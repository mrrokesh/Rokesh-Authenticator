import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { api, type EnrollmentSession } from '../lib/api';
import { ErrorBanner } from '../components/Layout';

type Status = 'PENDING' | 'COMPLETED' | 'EXPIRED';

export function EnrollPage() {
  const { employeeId } = useParams<{ employeeId: string }>();
  const [session, setSession] = useState<EnrollmentSession | null>(null);
  const [status, setStatus] = useState<Status>('PENDING');
  const [remaining, setRemaining] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const create = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const s = await api<EnrollmentSession>('/api/admin/enrollment-sessions', {
        method: 'POST',
        body: { employeeId },
      });
      setSession(s);
      setStatus('PENDING');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, [employeeId]);

  // Countdown until the QR expires.
  useEffect(() => {
    if (!session) return;
    const tick = () => {
      const left = Math.max(0, Math.round((new Date(session.expiresAt).getTime() - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0) setStatus((s) => (s === 'PENDING' ? 'EXPIRED' : s));
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [session]);

  // Poll the backend until the phone completes enrollment.
  useEffect(() => {
    if (!session || status !== 'PENDING') return;
    const t = setInterval(async () => {
      try {
        const res = await api<{ status: Status }>(`/api/admin/enrollment-sessions/${session.sessionId}`);
        setStatus(res.status);
      } catch (err) {
        setError((err as Error).message);
      }
    }, 2000);
    return () => clearInterval(t);
  }, [session, status]);

  const mm = String(Math.floor(remaining / 60)).padStart(2, '0');
  const ss = String(remaining % 60).padStart(2, '0');

  return (
    <section>
      <p><Link to="/employees">← Employees</Link></p>
      <h2>Enroll a device</h2>
      <ErrorBanner error={error} />
      {!session && (
        <div className="card">
          <p>
            This creates a single-use enrollment QR that expires in a few minutes. Show it to the employee and have
            them scan it with the <strong>MR ROKESH Authenticator</strong> app on their phone.
          </p>
          <p className="muted">Anyone who scans this QR first can enroll a device for this employee — only display it to them in person or over a trusted screen share.</p>
          <button onClick={create} disabled={busy}>{busy ? 'Creating…' : 'Generate enrollment QR'}</button>
        </div>
      )}
      {session && (
        <div className="card enroll">
          <div>
            <h3>{session.employee.name}</h3>
            <p className="muted">{session.employee.email}</p>
            {status === 'PENDING' && (
              <>
                <p>Waiting for the phone to scan… <strong>{mm}:{ss}</strong></p>
                <p className="muted">Open the app → “Scan enrollment QR”.</p>
              </>
            )}
            {status === 'COMPLETED' && (
              <p className="success">Device enrolled. The employee should now save their recovery codes shown in the app.</p>
            )}
            {status === 'EXPIRED' && (
              <>
                <p className="error">This QR expired or was replaced.</p>
                <button onClick={create} disabled={busy}>Generate a new QR</button>
              </>
            )}
          </div>
          <div className={`qr ${status !== 'PENDING' ? 'faded' : ''}`}>
            <QRCodeSVG value={session.qrPayload} size={280} level="M" marginSize={2} />
          </div>
        </div>
      )}
    </section>
  );
}
