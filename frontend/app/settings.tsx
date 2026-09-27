import { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { router } from 'expo-router';
import { useEnrollment } from '../components/EnrollmentContext';
import { Banner, Body, Button, Card, Screen, Title } from '../components/ui';
import { getDeviceInfo, type DeviceInfo } from '../services/api';
import { API_URL } from '../services/config';

export default function Settings() {
  const { enrollment, reset } = useEnrollment();
  const [info, setInfo] = useState<DeviceInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getDeviceInfo().then(setInfo).catch((err) => setError((err as Error).message));
  }, []);

  function removeDevice() {
    Alert.alert(
      'Remove from this phone?',
      'This deletes the device key and code generator from this phone. Ask your administrator to revoke the device as well, then enroll again with a new QR.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            await reset();
            router.replace('/');
          },
        },
      ],
    );
  }

  if (!enrollment) return null;

  return (
    <Screen>
      <Card>
        <Title>{enrollment.employee.name}</Title>
        <Body muted>{enrollment.employee.email}</Body>
        <Body>Device: {info?.deviceName ?? '—'}</Body>
        <Body>Enrolled: {new Date(enrollment.enrolledAt).toLocaleString()}</Body>
        <Body>Unused recovery codes: {info ? info.unusedRecoveryCodes : '—'}</Body>
        <Body muted>Server: {API_URL}</Body>
      </Card>
      {error && <Banner tone="warning">{error}</Banner>}
      <Button label="Remove from this phone" variant="danger" onPress={removeDevice} />
    </Screen>
  );
}
