import nacl from 'tweetnacl';
import crypto from 'node:crypto';

/**
 * Canonical messages signed by the device's Ed25519 private key.
 * These MUST stay byte-for-byte identical to frontend/services/deviceKeys.ts.
 * A domain-separation prefix per purpose prevents one signature being replayed as another.
 */
export const SIG_PREFIX = 'mr-rokesh-auth:v1';

export type Decision = 'APPROVE' | 'DENY';

export const enrollMessage = (enrollmentToken: string, publicKeyB64: string) =>
  `${SIG_PREFIX}:enroll\n${enrollmentToken}\n${publicKeyB64}`;

export const respondMessage = (challengeId: string, nonce: string, decision: Decision, timestamp: number) =>
  `${SIG_PREFIX}:respond\n${challengeId}\n${nonce}\n${decision}\n${timestamp}`;

export const requestMessage = (method: string, path: string, timestamp: number, body: string) =>
  `${SIG_PREFIX}:request\n${method.toUpperCase()}\n${path}\n${timestamp}\n${crypto
    .createHash('sha256')
    .update(body)
    .digest('hex')}`;

export function decodePublicKey(publicKeyB64: string): Uint8Array | null {
  try {
    const bytes = Buffer.from(publicKeyB64, 'base64');
    if (bytes.length !== nacl.sign.publicKeyLength) return null;
    // Reject non-canonical base64 (e.g. trailing garbage)
    if (bytes.toString('base64') !== publicKeyB64) return null;
    return new Uint8Array(bytes);
  } catch {
    return null;
  }
}

export function verifySignature(message: string, signatureB64: string, publicKeyB64: string): boolean {
  const publicKey = decodePublicKey(publicKeyB64);
  if (!publicKey) return false;
  let signature: Uint8Array;
  try {
    signature = new Uint8Array(Buffer.from(signatureB64, 'base64'));
  } catch {
    return false;
  }
  if (signature.length !== nacl.sign.signatureLength) return false;
  return nacl.sign.detached.verify(new Uint8Array(Buffer.from(message, 'utf8')), signature, publicKey);
}

/** Allowed clock skew between device and server for signed timestamps. */
export const MAX_CLOCK_SKEW_MS = 60_000;

export const isFreshTimestamp = (timestamp: number, nowMs = Date.now()) =>
  Number.isSafeInteger(timestamp) && Math.abs(nowMs - timestamp) <= MAX_CLOCK_SKEW_MS;
