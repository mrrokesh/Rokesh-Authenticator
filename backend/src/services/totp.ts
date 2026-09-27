import { authenticator } from 'otplib';

// RFC 6238: SHA-1, 6 digits, 30s step. Verification accepts ±1 time-step only.
authenticator.options = { digits: 6, step: 30, window: 1 };

export const TOTP_STEP_SECONDS = 30;

export function generateTotpSecret(): string {
  // 20 bytes (160 bits) → 32 base32 chars, per RFC 4226 recommendation
  return authenticator.generateSecret(20);
}

export function currentStep(nowMs = Date.now()): number {
  return Math.floor(nowMs / 1000 / TOTP_STEP_SECONDS);
}

/**
 * Returns the matched absolute time-step, or null when the code is invalid.
 * The caller uses the step to reject replays (a step can be accepted only once per device).
 */
export function verifyTotp(code: string, secret: string, nowMs = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const delta = authenticator.clone({ epoch: nowMs }).checkDelta(code, secret);
  if (delta === null) return null;
  return currentStep(nowMs) + delta;
}

export function otpauthUri(accountName: string, issuer: string, secret: string): string {
  return authenticator.keyuri(accountName, issuer, secret);
}
