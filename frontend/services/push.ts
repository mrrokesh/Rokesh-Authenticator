import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';

export const LOGIN_CHANNEL_ID = 'login-requests';

export type PushRegistration = { pushToken: string; pushPlatform: 'fcm' | 'apns' };

/**
 * Registers for remote push and returns the NATIVE device token:
 * an FCM registration token on Android, an APNs device token on iOS.
 * The backend sends to these directly (firebase-admin / APNs HTTP/2).
 *
 * Requires a development or release build — Expo Go cannot receive remote push.
 */
export async function registerForPush(): Promise<PushRegistration | null> {
  if (!Device.isDevice) return null; // simulators/emulators without Play services can't get tokens

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(LOGIN_CHANNEL_ID, {
      name: 'Login requests',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    });
  }

  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') {
    ({ status } = await Notifications.requestPermissionsAsync());
  }
  if (status !== 'granted') return null;

  const token = await Notifications.getDevicePushTokenAsync();
  return toRegistration(token);
}

export function toRegistration(token: Notifications.DevicePushToken): PushRegistration | null {
  if (typeof token.data !== 'string') return null;
  if (token.type === 'android') return { pushToken: token.data, pushPlatform: 'fcm' };
  if (token.type === 'ios') return { pushToken: token.data, pushPlatform: 'apns' };
  return null;
}

/** Pulls our challenge id out of a received notification, whatever shape the platform delivered. */
export function challengeIdFrom(notification: Notifications.Notification): string | null {
  const data = notification.request.content.data as Record<string, unknown> | undefined;
  const candidates: unknown[] = [data?.challengeId];
  if (typeof data?.body === 'string') {
    try {
      candidates.push(JSON.parse(data.body).challengeId);
    } catch {
      /* not JSON */
    }
  } else if (data?.body && typeof data.body === 'object') {
    candidates.push((data.body as Record<string, unknown>).challengeId);
  }
  const trigger = notification.request.trigger as { payload?: Record<string, unknown> } | null;
  candidates.push(trigger?.payload?.challengeId);

  const id = candidates.find((c) => typeof c === 'string' && /^[0-9a-f-]{36}$/i.test(c));
  return (id as string | undefined) ?? null;
}
