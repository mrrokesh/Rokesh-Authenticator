import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useEnrollment } from '../components/EnrollmentContext';
import { Banner, Body, Button, Screen, Title } from '../components/ui';
import { enrollWithToken, parseEnrollmentQr } from '../services/enrollment';
import { ApiError } from '../services/api';

export default function Enroll() {
  const [permission, requestPermission] = useCameraPermissions();
  const { reload } = useEnrollment();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Camera fires many events per second; process one scan at a time.
  const handling = useRef(false);

  async function onScanned(result: BarcodeScanningResult) {
    if (handling.current) return;
    handling.current = true;

    const token = parseEnrollmentQr(result.data);
    if (!token) {
      setError('That is not an MR ROKESH enrollment QR code.');
      setTimeout(() => (handling.current = false), 1500);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await enrollWithToken(token);
      await reload();
      router.replace('/recovery-codes');
    } catch (err) {
      const message =
        err instanceof ApiError && ['ENROLL_USED', 'ENROLL_EXPIRED', 'ENROLL_INVALID'].includes(err.code)
          ? `${err.message}. Ask your administrator for a new QR code.`
          : (err as Error).message;
      setError(message);
      setBusy(false);
      setTimeout(() => (handling.current = false), 1500);
    }
  }

  if (!permission) return <Screen><Body muted>Checking camera permission…</Body></Screen>;

  if (!permission.granted) {
    return (
      <Screen>
        <Title>Camera access</Title>
        <Body muted>The camera is used only to scan the enrollment QR code shown on your administrator’s screen.</Body>
        {!permission.canAskAgain && <Banner tone="warning">Camera access was denied. Enable it in system settings.</Banner>}
        <Button label="Allow camera" onPress={requestPermission} disabled={!permission.canAskAgain} />
      </Screen>
    );
  }

  return (
    <Screen scroll={false}>
      <Body muted>Point the camera at the QR code on the admin dashboard.</Body>
      <View style={styles.cameraWrap}>
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={busy ? undefined : onScanned}
        />
        <View style={styles.frame} pointerEvents="none" />
      </View>
      {busy && <Banner tone="success">Enrolling this device…</Banner>}
      {error && <Banner>{error}</Banner>}
    </Screen>
  );
}

const styles = StyleSheet.create({
  cameraWrap: { flex: 1, borderRadius: 16, overflow: 'hidden', minHeight: 320 },
  frame: {
    position: 'absolute',
    top: '20%',
    left: '15%',
    right: '15%',
    aspectRatio: 1,
    borderWidth: 3,
    borderColor: 'white',
    borderRadius: 16,
  },
});
