import { Banner, Body, Button, Card, Title } from './ui';
import { usePushStatus } from './usePushStatus';

/** Shows whether sign-in notifications work and offers the right fix for each state. */
export function PushSettingsCard() {
  const { status, busy, error, enable, openSettings } = usePushStatus();

  let description: string;
  let action: { label: string; onPress: () => void } | null = null;

  if (!status) {
    description = 'Checking…';
  } else if (!status.supported) {
    description = 'This device can’t receive push notifications (emulator or simulator). Requests still appear while the app is open.';
  } else if (!status.granted && status.canAskAgain) {
    description = 'Off. You’ll only see sign-in requests while the app is open.';
    action = { label: 'Turn on notifications', onPress: enable };
  } else if (!status.granted) {
    description = 'Blocked in your phone’s settings. Turn on notifications for MR ROKESH Authenticator there, then come back.';
    action = { label: 'Open phone settings', onPress: openSettings };
  } else if (status.serverRegistered === false) {
    description = 'Allowed on this phone, but not yet registered with the server.';
    action = { label: 'Register now', onPress: enable };
  } else if (status.serverRegistered === null) {
    description = 'Allowed on this phone. Couldn’t reach the server to confirm registration.';
    action = { label: 'Retry', onPress: enable };
  } else {
    description = 'On. Sign-in requests will arrive as notifications.';
  }

  return (
    <Card>
      <Title>Notifications</Title>
      <Body muted>{description}</Body>
      {error && <Banner>{error}</Banner>}
      {action && <Button label={action.label} onPress={action.onPress} busy={busy} />}
    </Card>
  );
}
