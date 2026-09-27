import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState, View } from 'react-native';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { EnrollmentProvider, useEnrollment } from '../components/EnrollmentContext';
import { Banner, Body, Button, Screen, Title } from '../components/ui';
import { useTheme } from '../components/theme';
import { challengeIdFrom, registerForPush, toRegistration } from '../services/push';
import { updatePushToken } from '../services/api';
import { confirmUserPresence } from '../services/biometrics';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/** Re-locks the app after it has been in the background this long. */
const RELOCK_AFTER_MS = 60_000;

function LockGate({ children }: { children: ReactNode }) {
  const { enrollment, loading } = useEnrollment();
  const [unlocked, setUnlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const backgroundedAt = useRef<number | null>(null);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') backgroundedAt.current = Date.now();
      if (state === 'active' && backgroundedAt.current && Date.now() - backgroundedAt.current > RELOCK_AFTER_MS) {
        setUnlocked(false);
      }
    });
    return () => sub.remove();
  }, []);

  const unlock = useCallback(() => {
    confirmUserPresence('Unlock MR ROKESH Authenticator')
      .then((ok) => {
        if (!ok) return;
        setError(null);
        setUnlocked(true);
      })
      .catch((err) => setError((err as Error).message));
  }, []);

  // Prompt automatically on launch and whenever the app re-locks.
  useEffect(() => {
    if (enrollment && !unlocked) unlock();
  }, [enrollment, unlocked, unlock]);

  if (loading) return <View style={{ flex: 1 }} />;
  // Nothing sensitive to protect before enrollment.
  if (!enrollment || unlocked) return <>{children}</>;

  return (
    <Screen scroll={false}>
      <View style={{ flex: 1, justifyContent: 'center', gap: 16 }}>
        <Title>Locked</Title>
        <Body muted>Verify it’s you to view codes and approve sign-ins.</Body>
        {error && <Banner>{error}</Banner>}
        <Button label="Unlock" onPress={unlock} />
      </View>
    </Screen>
  );
}

/** Routes notification taps to the approval screen and keeps the push token fresh. */
function PushBridge() {
  const { enrollment } = useEnrollment();

  useEffect(() => {
    const open = (n: Notifications.Notification) => {
      const id = challengeIdFrom(n);
      // Defer one tick so the navigator is mounted on cold start.
      if (id) setTimeout(() => router.push({ pathname: '/approve/[id]', params: { id } }), 0);
    };
    // Cold start from a notification tap
    Notifications.getLastNotificationResponseAsync().then((r) => {
      if (!r) return;
      // Consume it so the same tap doesn't reopen the screen on the next launch/unlock.
      Notifications.clearLastNotificationResponse();
      open(r.notification);
    });
    const sub = Notifications.addNotificationResponseReceivedListener((r) => {
      Notifications.clearLastNotificationResponse();
      open(r.notification);
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!enrollment) return;
    // Tokens can rotate between launches; re-register on each start and on change.
    registerForPush()
      .then((reg) => reg && updatePushToken(reg.pushToken, reg.pushPlatform))
      .catch(() => undefined);
    const sub = Notifications.addPushTokenListener((token) => {
      const reg = toRegistration(token);
      if (reg) updatePushToken(reg.pushToken, reg.pushPlatform).catch(() => undefined);
    });
    return () => sub.remove();
  }, [enrollment]);

  return null;
}

function Navigator() {
  const t = useTheme();
  return (
    <>
      <StatusBar style="auto" />
      <LockGate>
        <PushBridge />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: t.surface },
            headerTintColor: t.text,
            contentStyle: { backgroundColor: t.bg },
          }}
        >
          <Stack.Screen name="index" options={{ title: 'MR ROKESH Authenticator' }} />
          <Stack.Screen name="enroll" options={{ title: 'Enroll device' }} />
          <Stack.Screen name="recovery-codes" options={{ title: 'Recovery codes', headerBackVisible: false, gestureEnabled: false }} />
          <Stack.Screen name="approve/[id]" options={{ title: 'Sign-in request', presentation: 'modal' }} />
          <Stack.Screen name="settings" options={{ title: 'Settings' }} />
        </Stack>
      </LockGate>
    </>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <EnrollmentProvider>
        <Navigator />
      </EnrollmentProvider>
    </SafeAreaProvider>
  );
}
