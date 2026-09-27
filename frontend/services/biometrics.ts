import * as LocalAuthentication from 'expo-local-authentication';

export class ScreenLockRequiredError extends Error {
  constructor() {
    super('Set up a screen lock (PIN, fingerprint or Face ID) on this phone to use the authenticator.');
  }
}

/**
 * Prompts for biometrics, falling back to the device passcode.
 * Returns false if the user cancels; throws if the phone has no screen lock at all.
 */
export async function confirmUserPresence(promptMessage: string): Promise<boolean> {
  const level = await LocalAuthentication.getEnrolledLevelAsync();
  if (level === LocalAuthentication.SecurityLevel.NONE) throw new ScreenLockRequiredError();

  const result = await LocalAuthentication.authenticateAsync({
    promptMessage,
    cancelLabel: 'Cancel',
    disableDeviceFallback: false,
  });
  return result.success;
}
