import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking } from 'react-native';
import { getPushPermission, registerForPush, type PushPermission } from '../services/push';
import { getDeviceInfo, updatePushToken } from '../services/api';

export interface PushStatus extends PushPermission {
  /** Whether the backend holds a push token for this device (null = unknown / offline). */
  serverRegistered: boolean | null;
}

/**
 * Tracks notification permission + server registration, and re-checks when the app returns
 * to the foreground (e.g. after the employee flips the switch in the OS settings app).
 */
export function usePushStatus() {
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(async (): Promise<PushStatus> => {
    const permission = await getPushPermission();
    const serverRegistered = await getDeviceInfo()
      .then((d) => d.pushRegistered)
      .catch(() => null);
    return { ...permission, serverRegistered };
  }, []);

  /** Asks for permission if possible, then registers the token with the backend. */
  const enable = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const reg = await registerForPush();
      if (reg) await updatePushToken(reg.pushToken, reg.pushPlatform);
      setStatus(await check());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, [check]);

  /** Re-reads permission + server state (e.g. when a screen regains focus). */
  const recheck = useCallback(() => {
    check().then(setStatus).catch(() => undefined);
  }, [check]);

  useEffect(() => {
    let cancelled = false;
    const refresh = () =>
      check().then(async (s) => {
        if (cancelled) return;
        setStatus(s);
        // Permission was just granted in OS settings but the server has no token yet: register now.
        if (s.granted && s.serverRegistered === false) {
          const reg = await registerForPush().catch(() => null);
          if (reg && !cancelled) {
            await updatePushToken(reg.pushToken, reg.pushPlatform).catch(() => undefined);
            setStatus(await check());
          }
        }
      });
    refresh();
    const sub = AppState.addEventListener('change', (state) => state === 'active' && refresh());
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [check]);

  return { status, busy, error, enable, recheck, openSettings: () => Linking.openSettings() };
}

/** True when the employee should be told push is off (and can act on it). */
export const pushNeedsAttention = (s: PushStatus | null) =>
  !!s && s.supported && (!s.granted || s.serverRegistered === false);
