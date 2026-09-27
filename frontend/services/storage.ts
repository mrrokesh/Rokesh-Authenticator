import * as SecureStore from 'expo-secure-store';

/**
 * Everything sensitive lives in the platform keystore (iOS Keychain / Android Keystore-backed
 * EncryptedSharedPreferences) and never leaves this device, is never backed up, and is only
 * readable while the device is unlocked.
 */
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

const KEYS = {
  privateKeySeed: 'mrra.device.ed25519.seed',
  enrollment: 'mrra.enrollment',
} as const;

export interface TotpConfig {
  secret: string;
  issuer: string;
  accountName: string;
  algorithm: 'SHA1';
  digits: number;
  period: number;
}

export interface Enrollment {
  deviceId: string;
  publicKey: string;
  employee: { id: string; name: string; email: string };
  totp: TotpConfig;
  enrolledAt: string;
}

export const saveSeed = (seedB64: string) => SecureStore.setItemAsync(KEYS.privateKeySeed, seedB64, OPTIONS);
export const loadSeed = () => SecureStore.getItemAsync(KEYS.privateKeySeed, OPTIONS);

export const saveEnrollment = (e: Enrollment) => SecureStore.setItemAsync(KEYS.enrollment, JSON.stringify(e), OPTIONS);

export async function loadEnrollment(): Promise<Enrollment | null> {
  const raw = await SecureStore.getItemAsync(KEYS.enrollment, OPTIONS);
  return raw ? (JSON.parse(raw) as Enrollment) : null;
}

/** Wipes the private key and TOTP secret from this device. */
export async function clearAll() {
  await SecureStore.deleteItemAsync(KEYS.privateKeySeed, OPTIONS);
  await SecureStore.deleteItemAsync(KEYS.enrollment, OPTIONS);
}
