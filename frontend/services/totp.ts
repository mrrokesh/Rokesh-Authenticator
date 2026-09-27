import { hmac } from '@noble/hashes/hmac';
import { sha1 } from '@noble/hashes/sha1';
import { base32ToBytes } from './encoding';

/**
 * RFC 6238 TOTP (HMAC-SHA1, 6 digits, 30 s step) — matches otplib on the backend.
 * Implemented directly on @noble/hashes because otplib depends on Node's `crypto`,
 * which is not available in the Hermes runtime.
 */
export interface TotpParams {
  secret: string; // base32
  digits?: number;
  period?: number;
}

export function generateTotp({ secret, digits = 6, period = 30 }: TotpParams, nowMs = Date.now()): string {
  const counter = Math.floor(nowMs / 1000 / period);
  const msg = new Uint8Array(8);
  // 8-byte big-endian counter (split to stay within 32-bit bitwise ops)
  const high = Math.floor(counter / 0x100000000);
  const low = counter >>> 0;
  new DataView(msg.buffer).setUint32(0, high);
  new DataView(msg.buffer).setUint32(4, low);

  const mac = hmac(sha1, base32ToBytes(secret), msg);
  const offset = mac[mac.length - 1] & 0x0f;
  const binary =
    ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(binary % 10 ** digits).padStart(digits, '0');
}

export function secondsRemaining(period = 30, nowMs = Date.now()): number {
  return period - (Math.floor(nowMs / 1000) % period);
}
