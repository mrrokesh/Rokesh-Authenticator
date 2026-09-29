/* Global test setup: replaces native modules with deterministic in-memory versions. */

process.env.EXPO_PUBLIC_API_URL = 'http://api.test';

jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

// In-memory keystore so key generation / signing run for real in tests.
jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
    setItemAsync: jest.fn(async (k: string, v: string) => void store.set(k, v)),
    getItemAsync: jest.fn(async (k: string) => store.get(k) ?? null),
    deleteItemAsync: jest.fn(async (k: string) => void store.delete(k)),
    __store: store,
  };
});

// Real CSPRNG bytes from Node so the Ed25519 keys are genuine.
jest.mock('expo-crypto', () => ({
  getRandomBytes: (n: number) => new Uint8Array(require('crypto').randomBytes(n)),
}));

jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));

// expo-notifications warns about Expo Go at import time and needs native code; stub the surface we use.
jest.mock('expo-notifications', () => {
  const sub = () => ({ remove: jest.fn() });
  return {
    AndroidImportance: { MAX: 5 },
    AndroidNotificationVisibility: { PRIVATE: 0 },
    IosAuthorizationStatus: { PROVISIONAL: 3 },
    setNotificationHandler: jest.fn(),
    setNotificationChannelAsync: jest.fn(async () => null),
    getPermissionsAsync: jest.fn(async () => ({ granted: false, canAskAgain: true, status: 'undetermined' })),
    requestPermissionsAsync: jest.fn(async () => ({ granted: false, canAskAgain: true, status: 'denied' })),
    getDevicePushTokenAsync: jest.fn(async () => ({ type: 'android', data: 'fcm-token' })),
    addNotificationReceivedListener: jest.fn(sub),
    addNotificationResponseReceivedListener: jest.fn(sub),
    addPushTokenListener: jest.fn(sub),
    getLastNotificationResponseAsync: jest.fn(async () => null),
    clearLastNotificationResponse: jest.fn(),
  };
});
