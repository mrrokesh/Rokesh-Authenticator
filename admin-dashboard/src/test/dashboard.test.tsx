import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../lib/auth';
import { App } from '../App';
import { api, setAccessToken, setSessionLostHandler } from '../lib/api';
import { fakeApi } from './fakeApi';

const admin = { id: 'a1', email: 'admin@example.test', role: 'ADMIN' };

function renderApp(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
}

/** Routes needed for an already-signed-in admin (session resumed from the refresh cookie). */
const signedIn = {
  'POST /api/auth/refresh': () => ({ body: { accessToken: 'at-1' } }),
  'GET /api/auth/me': () => ({ body: { user: admin } }),
};

describe('API client session handling', () => {
  it('refreshes once on 401 and retries with the new token', async () => {
    let tokenOk = false;
    const { calls } = fakeApi({
      'GET /api/admin/devices': ({ headers }) =>
        headers.Authorization === 'Bearer fresh' ? { body: { devices: [] } } : { status: 401, body: { error: { code: 'TOKEN_INVALID' } } },
      'POST /api/auth/refresh': () => {
        tokenOk = true;
        return { body: { accessToken: 'fresh' } };
      },
    });
    setAccessToken('stale');
    const [a, b] = await Promise.all([api('/api/admin/devices'), api('/api/admin/devices')]);
    expect(a).toEqual({ devices: [] });
    expect(b).toEqual({ devices: [] });
    expect(tokenOk).toBe(true);
    // two concurrent 401s share a single refresh
    expect(calls.filter((c) => c.path === '/api/auth/refresh')).toHaveLength(1);
  });

  it('signals session loss when refresh fails', async () => {
    fakeApi({
      'GET /api/admin/devices': () => ({ status: 401, body: { error: { code: 'TOKEN_INVALID' } } }),
      'POST /api/auth/refresh': () => ({ status: 401, body: { error: { code: 'REFRESH_EXPIRED' } } }),
    });
    const lost = vi.fn();
    setSessionLostHandler(lost);
    setAccessToken('stale');
    await expect(api('/api/admin/devices')).rejects.toThrow();
    expect(lost).toHaveBeenCalled();
  });

  it('surfaces zod validation details in the error message', async () => {
    fakeApi({
      'POST /api/admin/employees': () => ({
        status: 400,
        body: { error: { code: 'VALIDATION_ERROR', message: 'Invalid request', issues: [{ path: 'email', message: 'Invalid email' }] } },
      }),
    });
    await expect(api('/api/admin/employees', { method: 'POST', body: {} })).rejects.toThrow('Invalid request (email: Invalid email)');
  });
});

describe('Login', () => {
  it('refuses non-admin accounts and signs them straight back out', async () => {
    const { calls } = fakeApi({
      'POST /api/auth/refresh': () => ({ status: 401, body: {} }),
      'POST /api/auth/login': () => ({ body: { accessToken: 'at', user: { ...admin, role: 'EMPLOYEE' } } }),
      'POST /api/auth/logout': () => ({ status: 204 }),
    });
    const user = userEvent.setup();
    renderApp('/login');
    await user.type(await screen.findByLabelText('Email'), 'bob@example.test');
    await user.type(screen.getByLabelText('Password'), 'bob-password-12345');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('for administrators only');
    expect(calls.some((c) => c.path === '/api/auth/logout')).toBe(true);
    expect(screen.queryByText('Employees')).not.toBeInTheDocument();
  });

  it('unauthenticated visits redirect to the login page', async () => {
    fakeApi({ 'POST /api/auth/refresh': () => ({ status: 401, body: {} }) });
    renderApp('/devices');
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });
});

describe('Enrollment QR', () => {
  it('shows a QR from the backend and reports completion when the phone enrolls', async () => {
    let status = 'PENDING';
    const qrPayload = JSON.stringify({ t: 'mrra-enroll', v: 1, token: 'tok' });
    const { calls } = fakeApi({
      ...signedIn,
      'POST /api/admin/enrollment-sessions': () => ({
        status: 201,
        body: {
          sessionId: 's1',
          expiresAt: new Date(Date.now() + 600_000).toISOString(),
          employee: { id: 'e1', name: 'Alice', email: 'alice@example.test' },
          qrPayload,
        },
      }),
      'GET /api/admin/enrollment-sessions/s1': () => ({ body: { status } }),
    });
    const user = userEvent.setup();
    const { container } = renderApp('/enroll/e1');

    await user.click(await screen.findByRole('button', { name: 'Generate enrollment QR' }));
    expect(calls.find((c) => c.path === '/api/admin/enrollment-sessions')?.body).toEqual({ employeeId: 'e1' });
    expect(await screen.findByText(/Waiting for the phone to scan/)).toBeInTheDocument();
    expect(container.querySelector('.qr svg')).not.toBeNull();

    status = 'COMPLETED'; // the phone finishes enrolling
    expect(await screen.findByText(/Device enrolled/, undefined, { timeout: 4000 })).toBeInTheDocument();
  });

  it('offers a fresh QR once the session expires', async () => {
    fakeApi({
      ...signedIn,
      'POST /api/admin/enrollment-sessions': () => ({
        status: 201,
        body: { sessionId: 's2', expiresAt: new Date(Date.now() - 1).toISOString(), employee: { id: 'e1', name: 'Alice', email: 'a@x.test' }, qrPayload: '{}' },
      }),
    });
    const user = userEvent.setup();
    renderApp('/enroll/e1');
    await user.click(await screen.findByRole('button', { name: 'Generate enrollment QR' }));
    expect(await screen.findByText('This QR expired or was replaced.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate a new QR' })).toBeInTheDocument();
  });
});

describe('Devices', () => {
  const device = {
    id: 'd1',
    deviceName: 'Pixel 9',
    keyAlgorithm: 'Ed25519',
    pushPlatform: 'fcm',
    pushRegistered: true,
    revoked: false,
    revokedAt: null,
    createdAt: new Date().toISOString(),
    unusedRecoveryCodes: 10,
    employee: { id: 'e1', name: 'Alice', email: 'alice@example.test' },
  };

  it('revokes with the reason the admin typed, and does nothing when cancelled', async () => {
    const { calls } = fakeApi({
      ...signedIn,
      'GET /api/admin/devices?includeRevoked=false': () => ({ body: { devices: [device] } }),
      'POST /api/admin/revoke-device': () => ({ body: { deviceId: 'd1', revoked: true } }),
    });
    const prompt = vi.spyOn(window, 'prompt').mockReturnValueOnce(null).mockReturnValueOnce('lost phone');
    const user = userEvent.setup();
    renderApp('/devices');

    const revoke = await screen.findByRole('button', { name: 'Revoke' });
    await user.click(revoke); // cancelled
    expect(calls.some((c) => c.path === '/api/admin/revoke-device')).toBe(false);

    await user.click(revoke);
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/api/admin/revoke-device')?.body).toEqual({ deviceId: 'd1', reason: 'lost phone' }),
    );
    expect(prompt).toHaveBeenCalledTimes(2);
  });
});
