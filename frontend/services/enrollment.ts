import * as Device from 'expo-device';
import { completeEnrollment } from './api';
import { createDeviceKeypair, enrollMessage, sign } from './deviceKeys';
import { registerForPush } from './push';
import { clearAll, saveEnrollment, type Enrollment } from './storage';

const QR_TYPE = 'mrra-enroll';

/** Returns the enrollment token from an admin-dashboard QR, or null for any other QR. */
export function parseEnrollmentQr(data: string): string | null {
  try {
    const parsed = JSON.parse(data);
    if (parsed?.t === QR_TYPE && parsed?.v === 1 && typeof parsed.token === 'string' && parsed.token.length >= 20) {
      return parsed.token;
    }
  } catch {
    /* not our QR */
  }
  return null;
}

// Recovery codes are handed to the next screen in memory only — never persisted or put in a URL.
let pendingRecoveryCodes: string[] | null = null;
export const takeRecoveryCodes = () => {
  const codes = pendingRecoveryCodes;
  pendingRecoveryCodes = null;
  return codes;
};

export async function enrollWithToken(token: string): Promise<Enrollment> {
  // Fresh keypair every enrollment; private key goes straight to secure storage.
  const { publicKey } = await createDeviceKeypair();
  const signature = await sign(enrollMessage(token, publicKey));

  // Push is optional at enrollment — the app can still approve via polling and register later.
  const push = await registerForPush().catch(() => null);

  try {
    const res = await completeEnrollment({
      token,
      publicKey,
      signature,
      deviceName: [Device.manufacturer, Device.modelName].filter(Boolean).join(' ') || undefined,
      ...(push ?? {}),
    });
    const enrollment: Enrollment = {
      deviceId: res.deviceId,
      publicKey,
      employee: res.employee,
      totp: res.totp,
      enrolledAt: new Date().toISOString(),
    };
    await saveEnrollment(enrollment);
    pendingRecoveryCodes = res.recoveryCodes;
    return enrollment;
  } catch (err) {
    await clearAll(); // don't leave an orphaned key behind
    throw err;
  }
}
