import { useEffect } from 'react';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { EnrollmentProvider, useEnrollment } from '../components/EnrollmentContext';
import { LockGate } from '../components/LockGate';
import { useTheme } from '../components/theme';
import { challengeIdFrom, registerForPush, toRegistration } from '../services/push';
import { updatePushToken } from '../services/api';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

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
