import nacl from 'tweetnacl';
import type { Notification } from 'expo-notifications';
import { generateTotp, secondsRemaining } from '../services/totp';
import { base32ToBytes, base64ToBytes, bytesToBase64 } from '../services/encoding';
import { parseEnrollmentQr } from '../services/enrollment';
import { challengeIdFrom } from '../services/push';
import { createDeviceKeypair, enrollMessage, requestMessage, respondMessage, sign } from '../services/deviceKeys';

const utf8 = (s: string) => new TextEncoder().encode(s);

describe('TOTP (RFC 6238 SHA-1 vectors, 6-digit truncation)', () => {
  const seed = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'; // "12345678901234567890"
  it.each([
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
  ])('T=%i → %s', (t, code) => {
    expect(generateTotp({ secret: seed }, t * 1000)).toBe(code);
  });

  it('counts down within the 30s period', () => {
    expect(secondsRemaining(30, 59_000)).toBe(1);
    expect(secondsRemaining(30, 60_000)).toBe(30);
  });
});

describe('encoding', () => {
  it('base64 round-trips every length', () => {
    for (let n = 0; n < 40; n++) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37 + n) & 0xff);
      expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
    }
  });
  it('decodes base32 and rejects invalid characters', () => {
    expect(Array.from(base32ToBytes('MZXW6==='))).toEqual([...utf8('foo')]);
    expect(() => base32ToBytes('1111')).toThrow();
  });
});

describe('parseEnrollmentQr', () => {
  const token = 'a'.repeat(43);
  it('accepts only our QR format', () => {
    expect(parseEnrollmentQr(JSON.stringify({ t: 'mrra-enroll', v: 1, token }))).toBe(token);
    expect(parseEnrollmentQr('https://example.com')).toBeNull();
    expect(parseEnrollmentQr(JSON.stringify({ t: 'other', v: 1, token }))).toBeNull();
    expect(parseEnrollmentQr(JSON.stringify({ t: 'mrra-enroll', v: 2, token }))).toBeNull();
    expect(parseEnrollmentQr(JSON.stringify({ t: 'mrra-enroll', v: 1, token: 'short' }))).toBeNull();
  });
});

describe('challengeIdFrom (push payload shapes)', () => {
  const id = '3f2a1c9e-8b7d-4e6f-a5b4-c3d2e1f0a9b8';
  const notif = (data: unknown, trigger: unknown = null) =>
    ({ request: { content: { data }, trigger } }) as unknown as Notification;

  it('finds the id in each place Android/iOS may put it', () => {
    expect(challengeIdFrom(notif({ challengeId: id }))).toBe(id);
    expect(challengeIdFrom(notif({ body: JSON.stringify({ challengeId: id }) }))).toBe(id); // Android data.body
    expect(challengeIdFrom(notif({ body: { challengeId: id } }))).toBe(id); // iOS body object
    expect(challengeIdFrom(notif({}, { payload: { challengeId: id } }))).toBe(id); // raw APNs payload
  });
  it('ignores anything that is not a uuid', () => {
    expect(challengeIdFrom(notif({ challengeId: '../../etc' }))).toBeNull();
    expect(challengeIdFrom(notif(undefined))).toBeNull();
  });
});

describe('device keys + canonical messages', () => {
  it('uses the exact formats the backend verifies', () => {
    expect(enrollMessage('tok', 'PUB')).toBe('mr-rokesh-auth:v1:enroll\ntok\nPUB');
    expect(respondMessage('c1', 'n1', 'APPROVE', 42)).toBe('mr-rokesh-auth:v1:respond\nc1\nn1\nAPPROVE\n42');
    // sha256('') = e3b0…b855
    expect(requestMessage('get', '/api/device/me', 7, '')).toBe(
      'mr-rokesh-auth:v1:request\nGET\n/api/device/me\n7\ne3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('creates a real Ed25519 key whose signatures verify, and keeps only the seed in secure storage', async () => {
    const { publicKey } = await createDeviceKeypair();
    const msg = respondMessage('c1', 'nonce', 'DENY', Date.now());
    const sig = await sign(msg);
    expect(nacl.sign.detached.verify(utf8(msg), base64ToBytes(sig), base64ToBytes(publicKey))).toBe(true);
    expect(nacl.sign.detached.verify(utf8(msg + 'x'), base64ToBytes(sig), base64ToBytes(publicKey))).toBe(false);

    const { __store } = jest.requireMock('expo-secure-store') as { __store: Map<string, string> };
    expect([...__store.keys()]).toEqual(['mrra.device.ed25519.seed']);
    expect(base64ToBytes(__store.get('mrra.device.ed25519.seed')!)).toHaveLength(32);
  });
});
