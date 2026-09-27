import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import nacl from 'tweetnacl';
import { authenticator } from 'otplib';
import { decryptSecret, encryptSecret } from '../src/services/encryption';
import { currentStep, generateTotpSecret, verifyTotp } from '../src/services/totp';
import { enrollMessage, isFreshTimestamp, requestMessage, respondMessage, verifySignature } from '../src/services/signature';
import { generateRecoveryCode, normalizeRecoveryCode } from '../src/services/recovery';

const key = crypto.randomBytes(32).toString('base64');

describe('AES-256-GCM secret encryption', () => {
  it('round-trips and uses a fresh IV each time', () => {
    const a = encryptSecret('JBSWY3DPEHPK3PXP', key);
    const b = encryptSecret('JBSWY3DPEHPK3PXP', key);
    expect(a).not.toEqual(b);
    expect(decryptSecret(a, key)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('rejects tampered ciphertext and wrong keys', () => {
    const enc = encryptSecret('secret', key);
    const parts = enc.split(':');
    const ct = Buffer.from(parts[3], 'base64');
    ct[0] ^= 0xff;
    parts[3] = ct.toString('base64');
    expect(() => decryptSecret(parts.join(':'), key)).toThrow();
    expect(() => decryptSecret(enc, crypto.randomBytes(32).toString('base64'))).toThrow();
  });
});

describe('TOTP (RFC 6238, SHA-1, 6 digits, 30s)', () => {
  // RFC 6238 Appendix B seed "12345678901234567890" in base32; 6-digit truncations of the published 8-digit values.
  const seed = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  const vectors: Array<[number, string]> = [
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
  ];

  it.each(vectors)('matches RFC vector at T=%i', (t, expected) => {
    expect(authenticator.clone({ epoch: t * 1000 }).generate(seed)).toBe(expected);
    expect(verifyTotp(expected, seed, t * 1000)).toBe(currentStep(t * 1000));
  });

  it('accepts ±1 step only', () => {
    const now = 1_700_000_000_000;
    const at = (ms: number) => authenticator.clone({ epoch: ms }).generate(seed);
    expect(verifyTotp(at(now - 30_000), seed, now)).toBe(currentStep(now) - 1);
    expect(verifyTotp(at(now + 30_000), seed, now)).toBe(currentStep(now) + 1);
    expect(verifyTotp(at(now - 60_000), seed, now)).toBeNull();
    expect(verifyTotp(at(now + 60_000), seed, now)).toBeNull();
  });

  it('rejects malformed codes and generates 160-bit secrets', () => {
    expect(verifyTotp('12345', seed)).toBeNull();
    expect(verifyTotp('abcdef', seed)).toBeNull();
    expect(generateTotpSecret()).toMatch(/^[A-Z2-7]{32}$/);
  });
});

describe('Ed25519 device signatures', () => {
  const kp = nacl.sign.keyPair();
  const pub = Buffer.from(kp.publicKey).toString('base64');
  const sign = (m: string) => Buffer.from(nacl.sign.detached(Buffer.from(m, 'utf8'), kp.secretKey)).toString('base64');

  it('verifies a respond signature and rejects any change', () => {
    const ts = Date.now();
    const msg = respondMessage('c1', 'nonce', 'APPROVE', ts);
    const sig = sign(msg);
    expect(verifySignature(msg, sig, pub)).toBe(true);
    expect(verifySignature(respondMessage('c1', 'nonce', 'DENY', ts), sig, pub)).toBe(false);
    expect(verifySignature(respondMessage('c1', 'nonce2', 'APPROVE', ts), sig, pub)).toBe(false);
    expect(verifySignature(msg, sig, Buffer.from(nacl.sign.keyPair().publicKey).toString('base64'))).toBe(false);
  });

  it('domain-separates enroll / respond / request messages', () => {
    const sig = sign(enrollMessage('tok', pub));
    expect(verifySignature(requestMessage('GET', '/api/device/me', 1, ''), sig, pub)).toBe(false);
  });

  it('rejects malformed keys and signatures', () => {
    expect(verifySignature('m', 'AAAA', pub)).toBe(false);
    expect(verifySignature('m', sign('m'), 'not-a-key')).toBe(false);
  });

  it('enforces a ±60s timestamp window', () => {
    const now = Date.now();
    expect(isFreshTimestamp(now - 59_000, now)).toBe(true);
    expect(isFreshTimestamp(now - 61_000, now)).toBe(false);
    expect(isFreshTimestamp(now + 61_000, now)).toBe(false);
  });
});

describe('recovery codes', () => {
  it('generates XXXXX-XXXXX codes that normalize back to themselves', () => {
    const code = generateRecoveryCode();
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);
    expect(normalizeRecoveryCode(code.toLowerCase().replace('-', ' '))).toBe(code);
    expect(normalizeRecoveryCode('O0O0O-11111')).toBeNull();
  });
});
