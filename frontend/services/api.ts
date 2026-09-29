import { API_URL } from './config';
import { requestMessage, respondMessage, sign, type Decision } from './deviceKeys';
import { loadEnrollment } from './storage';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function handle<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, body?.error?.code ?? 'HTTP_ERROR', body?.error?.message ?? `Request failed (${res.status})`);
  }
  return body as T;
}

async function request<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check your connection.');
  }
  return handle<T>(res);
}

/** Request authenticated with the device's Ed25519 key (see backend requireDevice middleware). */
async function signedRequest<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const enrollment = await loadEnrollment();
  if (!enrollment) throw new ApiError(0, 'NOT_ENROLLED', 'This device is not enrolled');
  const raw = body !== undefined ? JSON.stringify(body) : '';
  const timestamp = Date.now();
  const signature = await sign(requestMessage(method, path, timestamp, raw));
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        ...(raw ? { 'Content-Type': 'application/json' } : {}),
        'X-Device-Id': enrollment.deviceId,
        'X-Device-Timestamp': String(timestamp),
        'X-Device-Signature': signature,
      },
      body: raw || undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check your connection.');
  }
  return handle<T>(res);
}

/* ------------------------------- Types ------------------------------- */

export type ChallengeStatus = 'PENDING' | 'APPROVED' | 'DENIED' | 'EXPIRED';

export interface Challenge {
  id: string;
  nonce: string;
  status: ChallengeStatus;
  application: string | null;
  requestIp: string | null;
  createdAt: string;
  expiresAt: string;
}

export interface EnrollResponse {
  deviceId: string;
  employee: { id: string; name: string; email: string };
  totp: { secret: string; issuer: string; accountName: string; algorithm: 'SHA1'; digits: number; period: number };
  recoveryCodes: string[];
}

export interface DeviceInfo {
  deviceId: string;
  deviceName: string | null;
  enrolledAt: string;
  pushRegistered: boolean;
  pushPlatform: 'fcm' | 'apns' | null;
  employee: { name: string; email: string };
  unusedRecoveryCodes: number;
}

/* ----------------------------- Endpoints ----------------------------- */

export const completeEnrollment = (body: {
  token: string;
  publicKey: string;
  signature: string;
  deviceName?: string;
  pushToken?: string;
  pushPlatform?: 'fcm' | 'apns';
}) => request<EnrollResponse>('POST', '/api/enroll/complete', body);

export const getDeviceInfo = () => signedRequest<DeviceInfo>('GET', '/api/device/me');

export const listPendingChallenges = () =>
  signedRequest<{ challenges: Challenge[] }>('GET', '/api/device/challenges').then((r) => r.challenges);

export const getChallenge = (id: string) =>
  signedRequest<{ challenge: Challenge }>('GET', `/api/device/challenges/${encodeURIComponent(id)}`).then((r) => r.challenge);

export const updatePushToken = (pushToken: string, pushPlatform: 'fcm' | 'apns') =>
  signedRequest<void>('POST', '/api/device/push-token', { pushToken, pushPlatform });

export async function respondToChallenge(challenge: Challenge, decision: Decision) {
  const timestamp = Date.now();
  const signature = await sign(respondMessage(challenge.id, challenge.nonce, decision, timestamp));
  return request<{ challengeId: string; status: ChallengeStatus }>('POST', '/api/auth/login-request/respond', {
    challengeId: challenge.id,
    nonce: challenge.nonce,
    decision,
    timestamp,
    signature,
  });
}
