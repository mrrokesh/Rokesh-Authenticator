/**
 * End-to-end check against a RUNNING API and a DEVELOPMENT database.
 * Plays all three parties: admin (dashboard), phone (real Ed25519 keys), company system (X-API-Key).
 *
 *   E2E_API_URL=http://localhost:4000 E2E_ADMIN_EMAIL=... E2E_ADMIN_PASSWORD=... npm run test:e2e
 *
 * COMPANY_API_KEY is read from backend/.env. It creates throwaway employees with random
 * emails, then locks and revokes them — never point it at production.
 */
import 'dotenv/config';
import crypto from 'node:crypto';
import nacl from 'tweetnacl';
import { authenticator } from 'otplib';
import { enrollMessage, requestMessage, respondMessage } from '../../src/services/signature';

const API = (process.env.E2E_API_URL ?? 'http://localhost:4000').replace(/\/$/, '');
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? process.env.ADMIN_EMAIL ?? '';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? process.env.ADMIN_PASSWORD ?? '';
const API_KEY = process.env.COMPANY_API_KEY ?? '';
if (!ADMIN_EMAIL || !ADMIN_PASSWORD || !API_KEY) {
  console.error('Set E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD and COMPANY_API_KEY (backend/.env).');
  process.exit(2);
}
const K = { 'X-API-Key': API_KEY };

let pass = 0;
let fail = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}`, extra === undefined ? '' : JSON.stringify(extra));
  }
};
const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64');
const totpAt = (secret: string, ms: number) => authenticator.clone({ epoch: ms }).generate(secret);

async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}

async function main() {
  const tag = crypto.randomBytes(4).toString('hex');
  const aliceEmail = `e2e-alice-${tag}@example.test`;
  const bobEmail = `e2e-bob-${tag}@example.test`;

  console.log('Admin login');
  const login = await call('POST', '/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  check('admin login 200', login.status === 200, login.body);
  if (login.status !== 200) throw new Error('Cannot continue without admin login');
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  const A = { Authorization: `Bearer ${login.body.accessToken}` };

  const emp = await call('POST', '/api/admin/employees', { email: aliceEmail, name: 'E2E Alice' }, A);
  check('create employee 201', emp.status === 201, emp.body);
  const empId = emp.body.employee.id;
  check('duplicate email 409', (await call('POST', '/api/admin/employees', { email: aliceEmail, name: 'Dup' }, A)).status === 409);
  check('bad body 400 (zod)', (await call('POST', '/api/admin/employees', { email: 'not-an-email' }, A)).status === 400);

  await call('POST', '/api/admin/employees', { email: bobEmail, name: 'E2E Bob', password: 'bob-password-12345' }, A);
  const bob = await call('POST', '/api/auth/login', { email: bobEmail, password: 'bob-password-12345' });
  check('EMPLOYEE role gets 403 on admin route', (await call('GET', '/api/admin/employees', undefined, { Authorization: `Bearer ${bob.body.accessToken}` })).status === 403);
  check('no token gets 401 on admin route', (await call('GET', '/api/admin/devices')).status === 401);

  console.log('Enrollment');
  const sess = await call('POST', '/api/admin/enrollment-sessions', { employeeId: empId }, A);
  check('create enrollment session 201', sess.status === 201, sess.body);
  const { token } = JSON.parse(sess.body.qrPayload);

  const kp = nacl.sign.keyPair();
  const pub = b64(kp.publicKey);
  const sign = (m: string) => b64(nacl.sign.detached(Buffer.from(m, 'utf8'), kp.secretKey));

  const wrongKey = nacl.sign.keyPair();
  const badProof = await call('POST', '/api/enroll/complete', { token, publicKey: pub, signature: b64(nacl.sign.detached(Buffer.from(enrollMessage(token, pub)), wrongKey.secretKey)) });
  check('enroll with bad key proof rejected', badProof.status === 401, badProof.body);

  const enr = await call('POST', '/api/enroll/complete', { token, publicKey: pub, signature: sign(enrollMessage(token, pub)), deviceName: 'E2E Phone' });
  check('enroll complete 201', enr.status === 201, enr.body);
  check('10 recovery codes returned', enr.body.recoveryCodes?.length === 10);
  const deviceId: string = enr.body.deviceId;
  const secret: string = enr.body.totp.secret;

  const reuse = await call('POST', '/api/enroll/complete', { token, publicKey: pub, signature: sign(enrollMessage(token, pub)) });
  check('enrollment token single-use (410)', reuse.status === 410, reuse.body);
  check('session status COMPLETED', (await call('GET', `/api/admin/enrollment-sessions/${sess.body.sessionId}`, undefined, A)).body.status === 'COMPLETED');

  const signedGet = (path: string) => {
    const ts = Date.now();
    return call('GET', path, undefined, { 'X-Device-Id': deviceId, 'X-Device-Timestamp': String(ts), 'X-Device-Signature': sign(requestMessage('GET', path, ts, '')) });
  };
  check('device /me with signature 200', (await signedGet('/api/device/me')).status === 200);
  check('device /me with bad signature 401', (await call('GET', '/api/device/me', undefined, { 'X-Device-Id': deviceId, 'X-Device-Timestamp': String(Date.now()), 'X-Device-Signature': sign('nope') })).status === 401);

  console.log('Push login approval');
  check('login-request without API key 401', (await call('POST', '/api/auth/login-request', { email: aliceEmail })).status === 401);
  const lr = await call('POST', '/api/auth/login-request', { email: aliceEmail, application: 'Payroll', requestIp: '203.0.113.7' }, K);
  check('login-request 201', lr.status === 201, lr.body);
  check('undelivered push is reported, not faked', lr.body.pushDelivered === false && lr.body.pushError === 'no_push_token', lr.body);
  const pending = await signedGet('/api/device/challenges');
  const ch = pending.body.challenges?.[0];
  check('device sees pending challenge', ch?.id === lr.body.challengeId, pending.body);

  const ts = Date.now();
  const forged = await call('POST', '/api/auth/login-request/respond', { challengeId: ch.id, nonce: ch.nonce, decision: 'APPROVE', timestamp: ts, signature: sign(respondMessage(ch.id, ch.nonce, 'DENY', ts)) });
  check('decision tampering rejected', forged.status === 401, forged.body);
  const stale = Date.now() - 120_000;
  check('stale timestamp rejected', (await call('POST', '/api/auth/login-request/respond', { challengeId: ch.id, nonce: ch.nonce, decision: 'APPROVE', timestamp: stale, signature: sign(respondMessage(ch.id, ch.nonce, 'APPROVE', stale)) })).status === 401);

  const okBody = { challengeId: ch.id, nonce: ch.nonce, decision: 'APPROVE', timestamp: ts, signature: sign(respondMessage(ch.id, ch.nonce, 'APPROVE', ts)) };
  const ok = await call('POST', '/api/auth/login-request/respond', okBody);
  check('signed approve 200', ok.status === 200 && ok.body.status === 'APPROVED', ok.body);
  check('replay of same signed response rejected (409)', (await call('POST', '/api/auth/login-request/respond', okBody)).status === 409);
  check('company system sees APPROVED', (await call('GET', `/api/auth/login-request/${ch.id}`, undefined, K)).body.status === 'APPROVED');

  const lr2 = await call('POST', '/api/auth/login-request', { email: aliceEmail, application: 'VPN' }, K);
  const ch2 = (await signedGet(`/api/device/challenges/${lr2.body.challengeId}`)).body.challenge;
  const ts2 = Date.now();
  const deny = await call('POST', '/api/auth/login-request/respond', { challengeId: ch2.id, nonce: ch2.nonce, decision: 'DENY', timestamp: ts2, signature: sign(respondMessage(ch2.id, ch2.nonce, 'DENY', ts2)) });
  check('signed deny 200 → DENIED', deny.body?.status === 'DENIED', deny.body);

  if (process.env.E2E_SLOW === '1') {
    console.log('Challenge expiry (waits 61s)');
    const lr3 = await call('POST', '/api/auth/login-request', { email: aliceEmail }, K);
    const ch3 = (await signedGet(`/api/device/challenges/${lr3.body.challengeId}`)).body.challenge;
    await new Promise((r) => setTimeout(r, 61_000));
    const ts3 = Date.now();
    const late = await call('POST', '/api/auth/login-request/respond', { challengeId: ch3.id, nonce: ch3.nonce, decision: 'APPROVE', timestamp: ts3, signature: sign(respondMessage(ch3.id, ch3.nonce, 'APPROVE', ts3)) });
    check('approve after 60s rejected (410 CHALLENGE_EXPIRED)', late.status === 410 && late.body.error.code === 'CHALLENGE_EXPIRED', late.body);
    check('company system sees EXPIRED', (await call('GET', `/api/auth/login-request/${ch3.id}`, undefined, K)).body.status === 'EXPIRED');
    check('expired challenge no longer listed on device', !(await signedGet('/api/device/challenges')).body.challenges.some((c: { id: string }) => c.id === ch3.id));
  }

  console.log('TOTP');
  const now = Date.now();
  const v1 = await call('POST', '/api/totp/verify', { email: aliceEmail, code: totpAt(secret, now) }, K);
  check('valid TOTP accepted', v1.body.valid === true, v1.body);
  const v2 = await call('POST', '/api/totp/verify', { email: aliceEmail, code: totpAt(secret, now) }, K);
  check('same TOTP replay rejected', v2.body.valid === false && v2.body.reason === 'CODE_ALREADY_USED', v2.body);

  console.log('Recovery codes');
  const rc: string = enr.body.recoveryCodes[0];
  const r1 = await call('POST', '/api/recovery/verify', { email: aliceEmail, code: rc.toLowerCase() }, K);
  check('recovery code accepted (case-insensitive)', r1.body.valid === true && r1.body.remaining === 9, r1.body);
  check('recovery code single-use', (await call('POST', '/api/recovery/verify', { email: aliceEmail, code: rc }, K)).body.valid === false);

  console.log('Refresh rotation');
  const ref1 = await call('POST', '/api/auth/refresh', undefined, { Cookie: cookie });
  check('refresh 200', ref1.status === 200, ref1.body);
  const reused = await call('POST', '/api/auth/refresh', undefined, { Cookie: cookie });
  check('reused refresh token rejected', reused.status === 401 && reused.body.error.code === 'REFRESH_REUSED', reused.body);

  console.log('Revocation');
  const rv = await call('POST', '/api/admin/revoke-device', { deviceId, reason: 'e2e' }, A);
  check('revoke 200', rv.status === 200, rv.body);
  check('revoked device rejected on signed request', (await signedGet('/api/device/me')).body?.error?.code === 'DEVICE_REVOKED');
  const v3 = await call('POST', '/api/totp/verify', { email: aliceEmail, code: totpAt(secret, Date.now() + 30_000) }, K);
  check('revoked device TOTP not accepted', v3.body.valid === false, v3.body);
  check('login-request with only a revoked device → NO_DEVICE', (await call('POST', '/api/auth/login-request', { email: aliceEmail }, K)).body?.error?.code === 'NO_DEVICE');

  console.log('Lockout');
  let last = await call('POST', '/api/totp/verify', { email: aliceEmail, code: '000000' }, K);
  for (let i = 0; i < 5; i++) last = await call('POST', '/api/totp/verify', { email: aliceEmail, code: '000000' }, K);
  check('account locked after repeated failures (423)', last.status === 423, last.body);

  console.log('Audit');
  const audit = await call('GET', `/api/admin/audit-logs?limit=200&employeeId=${empId}`, undefined, A);
  const actions = new Set(audit.body.logs.map((l: { action: string }) => l.action));
  for (const a of ['CREATE_EMPLOYEE', 'CREATE_ENROLLMENT_SESSION', 'ENROLL', 'LOGIN_REQUEST', 'APPROVE', 'DENY', 'TOTP_VERIFIED', 'TOTP_FAILED', 'RECOVERY_CODE_USED', 'REVOKE', 'LOCKOUT'])
    check(`audit has ${a}`, actions.has(a));
  const dump = JSON.stringify(audit.body);
  check('audit log contains no TOTP secret or recovery code', !dump.includes(secret) && !dump.includes(rc));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
