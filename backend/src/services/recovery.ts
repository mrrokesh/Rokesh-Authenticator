import crypto from 'node:crypto';
import bcrypt from 'bcrypt';

// No 0/O/1/I to avoid transcription errors. 32 symbols × 10 chars = 50 bits per code.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const RECOVERY_CODE_COUNT = 10;
const BCRYPT_COST = 12;

export function generateRecoveryCode(): string {
  let out = '';
  for (let i = 0; i < 10; i++) out += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return `${out.slice(0, 5)}-${out.slice(5)}`;
}

/** Uppercases and strips whitespace/dashes, then re-inserts the canonical dash. */
export function normalizeRecoveryCode(input: string): string | null {
  const raw = input.toUpperCase().replace(/[\s-]/g, '');
  if (raw.length !== 10 || [...raw].some((c) => !ALPHABET.includes(c))) return null;
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}

export async function generateRecoveryCodes(): Promise<{ plain: string[]; hashes: string[] }> {
  const plain = Array.from({ length: RECOVERY_CODE_COUNT }, generateRecoveryCode);
  const hashes = await Promise.all(plain.map((c) => bcrypt.hash(c, BCRYPT_COST)));
  return { plain, hashes };
}
