import crypto from 'node:crypto';

const VERSION = 'v1';

/**
 * AES-256-GCM. Output format: v1:<iv b64>:<authTag b64>:<ciphertext b64>
 * A fresh 96-bit IV is generated for every encryption.
 */
export function encryptSecret(plaintext: string, keyB64: string): string {
  const key = Buffer.from(keyB64, 'base64');
  if (key.length !== 32) throw new Error('Encryption key must be 32 bytes');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(':');
}

export function decryptSecret(payload: string, keyB64: string): string {
  const key = Buffer.from(keyB64, 'base64');
  if (key.length !== 32) throw new Error('Encryption key must be 32 bytes');
  const [version, ivB64, tagB64, ctB64] = payload.split(':');
  if (version !== VERSION || !ivB64 || !tagB64 || ctB64 === undefined) {
    throw new Error('Unsupported encrypted payload');
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
}

export const sha256Hex = (value: string | Buffer) => crypto.createHash('sha256').update(value).digest('hex');

/** URL-safe random token with `bytes` bytes of entropy. */
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

export function timingSafeEqualStr(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}
