const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '');
if (!API_URL) throw new Error('VITE_API_URL is not set — copy admin-dashboard/.env.example to .env');

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

// Access token lives in memory only; the refresh token is an httpOnly cookie set by the API.
let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;
let onSessionLost: () => void = () => {};

export const setSessionLostHandler = (fn: () => void) => {
  onSessionLost = fn;
};
export const setAccessToken = (token: string | null) => {
  accessToken = token;
};

async function parse(res: Response) {
  if (res.status === 204) return null;
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const err = body?.error;
    const detail = err?.issues?.map((i: { path: string; message: string }) => `${i.path}: ${i.message}`).join('; ');
    throw new ApiError(res.status, err?.code ?? 'HTTP_ERROR', detail ? `${err.message} (${detail})` : err?.message ?? res.statusText);
  }
  return body;
}

/** Rotates the refresh cookie and stores a new access token. Concurrent callers share one request. */
export function refreshSession(): Promise<boolean> {
  refreshing ??= fetch(`${API_URL}/api/auth/refresh`, { method: 'POST', credentials: 'include' })
    .then(async (res) => {
      if (!res.ok) return false;
      const body = await res.json();
      accessToken = body.accessToken;
      return true;
    })
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}, retry = true): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: init.method ?? 'GET',
    credentials: 'include',
    headers: {
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (res.status === 401 && retry && !path.startsWith('/api/auth/')) {
    if (await refreshSession()) return api<T>(path, init, false);
    accessToken = null;
    onSessionLost();
  }
  return parse(res) as Promise<T>;
}

/* ------------------------------- Types ------------------------------- */

export type Role = 'ADMIN' | 'EMPLOYEE';

export interface User {
  id: string;
  email: string;
  name?: string;
  role: Role;
}

export interface Employee {
  id: string;
  email: string;
  name: string;
  role: Role;
  active: boolean;
  lockedUntil: string | null;
  createdAt: string;
  activeDevices: number;
}

export interface Device {
  id: string;
  deviceName: string | null;
  keyAlgorithm: string;
  pushPlatform: 'fcm' | 'apns' | null;
  pushRegistered: boolean;
  revoked: boolean;
  revokedAt: string | null;
  createdAt: string;
  unusedRecoveryCodes: number;
  employee: { id: string; name: string; email: string };
}

export interface AuditLog {
  id: string;
  action: string;
  ipAddress: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  employee: { id: string; name: string; email: string };
}

export interface EnrollmentSession {
  sessionId: string;
  expiresAt: string;
  employee: { id: string; name: string; email: string };
  qrPayload: string;
}

export const AUDIT_ACTIONS = [
  'APPROVE', 'DENY', 'ENROLL', 'REVOKE', 'LOGIN', 'LOGIN_FAILED', 'LOGOUT', 'LOCKOUT',
  'RECOVERY_CODE_USED', 'RECOVERY_FAILED', 'TOTP_VERIFIED', 'TOTP_FAILED', 'LOGIN_REQUEST',
  'CREATE_EMPLOYEE', 'UPDATE_EMPLOYEE', 'CREATE_ENROLLMENT_SESSION',
] as const;
