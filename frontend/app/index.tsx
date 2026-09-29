import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router, Stack, useFocusEffect } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { useEnrollment } from '../components/EnrollmentContext';
import { TotpCard } from '../components/TotpCard';
import { Banner, Body, Button, Card, Screen, Title } from '../components/ui';
import { useTheme } from '../components/theme';
import { pushNeedsAttention, usePushStatus } from '../components/usePushStatus';
import { ApiError, getDeviceInfo, listPendingChallenges, type Challenge } from '../services/api';

const POLL_MS = 5000;

export default function Home() {
  const { enrollment } = useEnrollment();
  return enrollment ? <Enrolled /> : <Welcome />;
}

function Welcome() {
  return (
    <Screen>
      <View style={{ flex: 1, justifyContent: 'center', gap: 16 }}>
        <Title>Set up this phone</Title>
        <Body muted>
          Ask your administrator to open the MR ROKESH admin dashboard and generate an enrollment QR code for you.
          Then scan it here.
        </Body>
        <Button label="Scan enrollment QR" onPress={() => router.push('/enroll')} />
      </View>
    </Screen>
  );
}

function Enrolled() {
  const t = useTheme();
  const { enrollment } = useEnrollment();
  const [pending, setPending] = useState<Challenge[]>([]);
  const [revoked, setRevoked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const push = usePushStatus();
  const { recheck: recheckPush } = push;

  const refresh = useCallback(async () => {
    try {
      setPending(await listPendingChallenges());
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'DEVICE_REVOKED') setRevoked(true);
      else setError((err as Error).message);
    }
  }, []);

  // Poll while this screen is focused, so requests show even if a push was missed.
  useFocusEffect(
    useCallback(() => {
      getDeviceInfo().catch((err) => {
        if (err instanceof ApiError && err.code === 'DEVICE_REVOKED') setRevoked(true);
      });
      refresh();
      recheckPush(); // picks up changes made on the Settings screen
      const id = setInterval(refresh, POLL_MS);
      return () => clearInterval(id);
    }, [refresh, recheckPush]),
  );

  // Refresh immediately when a push arrives in the foreground.
  useEffect(() => {
    const sub = Notifications.addNotificationReceivedListener(() => refresh());
    return () => sub.remove();
  }, [refresh]);

  if (!enrollment) return null;

  return (
    <Screen>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable onPress={() => router.push('/settings')} hitSlop={12}>
              <Text style={{ color: t.accent, fontSize: 16 }}>Settings</Text>
            </Pressable>
          ),
        }}
      />
      {revoked && (
        <Banner>
          This device was revoked by an administrator. Codes from it are no longer accepted. Open Settings to remove
          it and enroll again.
        </Banner>
      )}
      {error && <Banner tone="warning">{error}</Banner>}
      {!revoked && pushNeedsAttention(push.status) && (
        <Card>
          <Body>Notifications are off, so you’ll only see sign-in requests while this app is open.</Body>
          <Button variant="secondary" label="Fix in Settings" onPress={() => router.push('/settings')} />
        </Card>
      )}

      {pending.map((c) => (
        <Card key={c.id} style={{ borderColor: t.accent, borderWidth: 2 }}>
          <Title>Sign-in request</Title>
          <Body>
            {c.application ?? 'A company system'} is asking you to approve a sign-in
            {c.requestIp ? ` from ${c.requestIp}` : ''}.
          </Body>
          <Button label="Review" onPress={() => router.push({ pathname: '/approve/[id]', params: { id: c.id } })} />
        </Card>
      ))}

      {!revoked && <TotpCard totp={enrollment.totp} />}
      <Body muted center>
        Signed in as {enrollment.employee.name} ({enrollment.employee.email})
      </Body>
    </Screen>
  );
}
