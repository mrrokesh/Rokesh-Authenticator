import http2 from 'node:http2';
import jwt from 'jsonwebtoken';
import admin from 'firebase-admin';
import { env } from '../config/env';

export type PushPlatform = 'fcm' | 'apns';

export interface LoginPushPayload {
  challengeId: string;
  application: string | null;
  expiresAt: Date;
}

export interface PushResult {
  delivered: boolean;
  /** Set when not delivered. `not_configured` names the missing .env variables. */
  error?: string;
  /** True when the provider reports the token is permanently invalid. */
  invalidToken?: boolean;
}

const TITLE = 'Login request';
const bodyText = (p: LoginPushPayload) =>
  p.application ? `Approve sign-in to ${p.application}?` : 'Approve sign-in to a company system?';

/* ----------------------------- Android / FCM ----------------------------- */

let firebaseApp: admin.app.App | null = null;

function getFirebase(): admin.app.App | null {
  if (firebaseApp) return firebaseApp;
  if (!env.FIREBASE_SERVICE_ACCOUNT_BASE64) return null;
  const serviceAccount = JSON.parse(Buffer.from(env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8'));
  firebaseApp = admin.initializeApp({ credential: admin.credential.cert(serviceAccount) }, 'mr-rokesh-auth');
  return firebaseApp;
}

async function sendFcm(token: string, payload: LoginPushPayload): Promise<PushResult> {
  const app = getFirebase();
  if (!app) return { delivered: false, error: 'not_configured: FIREBASE_SERVICE_ACCOUNT_BASE64' };

  const ttlMs = Math.max(0, payload.expiresAt.getTime() - Date.now());
  const data = { type: 'login_request', challengeId: payload.challengeId };
  try {
    await app.messaging().send({
      token,
      notification: { title: TITLE, body: bodyText(payload) },
      // expo-notifications reads JSON from the `body` data key on Android
      data: { ...data, body: JSON.stringify(data) },
      android: {
        priority: 'high',
        ttl: ttlMs,
        notification: { channelId: 'login-requests', sound: 'default' },
      },
    });
    return { delivered: true };
  } catch (err) {
    const code = (err as { code?: string }).code ?? 'unknown';
    const invalidToken =
      code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token';
    return { delivered: false, error: code, invalidToken };
  }
}

/* ------------------------------ iOS / APNs ------------------------------ */

let apnsJwt: { token: string; issuedAt: number } | null = null;

function apnsConfigured(): string | null {
  const missing = ['APNS_KEY_ID', 'APNS_TEAM_ID', 'APNS_PRIVATE_KEY_BASE64', 'APNS_BUNDLE_ID'].filter(
    (k) => !env[k as keyof typeof env],
  );
  return missing.length ? missing.join(', ') : null;
}

function getApnsJwt(): string {
  // Apple requires refreshing provider tokens between 20 and 60 minutes.
  if (apnsJwt && Date.now() - apnsJwt.issuedAt < 40 * 60_000) return apnsJwt.token;
  const key = Buffer.from(env.APNS_PRIVATE_KEY_BASE64, 'base64').toString('utf8');
  const token = jwt.sign({ iss: env.APNS_TEAM_ID }, key, {
    algorithm: 'ES256',
    header: { alg: 'ES256', kid: env.APNS_KEY_ID },
  });
  apnsJwt = { token, issuedAt: Date.now() };
  return token;
}

function sendApns(deviceToken: string, payload: LoginPushPayload): Promise<PushResult> {
  const missing = apnsConfigured();
  if (missing) return Promise.resolve({ delivered: false, error: `not_configured: ${missing}` });

  const host = env.APNS_USE_SANDBOX ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com';
  const data = { type: 'login_request', challengeId: payload.challengeId };
  const body = JSON.stringify({
    aps: { alert: { title: TITLE, body: bodyText(payload) }, sound: 'default', 'interruption-level': 'time-sensitive' },
    ...data,
    // expo-notifications exposes the `body` key as notification.request.content.data on iOS
    body: data,
  });

  return new Promise((resolve) => {
    const client = http2.connect(host);
    client.on('error', (err) => resolve({ delivered: false, error: `apns_connection: ${err.message}` }));
    const req = client.request({
      ':method': 'POST',
      ':path': `/3/device/${deviceToken}`,
      authorization: `bearer ${getApnsJwt()}`,
      'apns-topic': env.APNS_BUNDLE_ID,
      'apns-push-type': 'alert',
      'apns-priority': '10',
      'apns-expiration': String(Math.floor(payload.expiresAt.getTime() / 1000)),
      'content-type': 'application/json',
    });
    let status = 0;
    let responseBody = '';
    req.setEncoding('utf8');
    req.on('response', (headers) => {
      status = Number(headers[':status']);
    });
    req.on('data', (chunk: string) => (responseBody += chunk));
    req.on('end', () => {
      client.close();
      if (status === 200) return resolve({ delivered: true });
      let reason = 'unknown';
      try {
        reason = JSON.parse(responseBody).reason ?? reason;
      } catch {
        /* empty body */
      }
      resolve({
        delivered: false,
        error: `apns_${status}: ${reason}`,
        invalidToken: status === 410 || reason === 'BadDeviceToken' || reason === 'Unregistered',
      });
    });
    req.on('error', (err) => {
      client.close();
      resolve({ delivered: false, error: `apns_request: ${err.message}` });
    });
    req.end(body);
  });
}

export function sendLoginPush(platform: PushPlatform, token: string, payload: LoginPushPayload): Promise<PushResult> {
  return platform === 'apns' ? sendApns(token, payload) : sendFcm(token, payload);
}
