import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Banner, Body, Button, Card, Screen, Title } from '../../components/ui';
import { ApiError, getChallenge, respondToChallenge, type Challenge } from '../../services/api';
import { confirmUserPresence } from '../../services/biometrics';
import type { Decision } from '../../services/deviceKeys';

export default function Approve() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [left, setLeft] = useState(0);
  const [busy, setBusy] = useState<Decision | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getChallenge(id)
      .then((c) => !cancelled && setChallenge(c))
      .catch((err) => !cancelled && setError((err as Error).message));
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (!challenge) return;
    const tick = () => setLeft(Math.max(0, Math.round((new Date(challenge.expiresAt).getTime() - Date.now()) / 1000)));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [challenge]);

  async function respond(decision: Decision) {
    if (!challenge) return;
    setError(null);
    try {
      // Approving requires biometrics / device passcode; denying never should be blocked.
      if (decision === 'APPROVE' && !(await confirmUserPresence('Approve sign-in'))) return;
      setBusy(decision);
      const res = await respondToChallenge(challenge, decision);
      setResult(res.status === 'APPROVED' ? 'Sign-in approved.' : 'Sign-in denied.');
      setTimeout(() => (router.canGoBack() ? router.back() : router.replace('/')), 1200);
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'CHALLENGE_CONSUMED'
          ? 'This request was already answered.'
          : (err as Error).message,
      );
    } finally {
      setBusy(null);
    }
  }

  const expired = challenge && (challenge.status !== 'PENDING' || left === 0);

  return (
    <Screen>
      {!challenge && !error && <Body muted>Loading request…</Body>}
      {challenge && (
        <Card>
          <Title>Is this you signing in?</Title>
          <Body>
            <Body muted>Application: </Body>
            {challenge.application ?? 'Company system'}
          </Body>
          {challenge.requestIp && (
            <Body>
              <Body muted>From IP: </Body>
              {challenge.requestIp}
            </Body>
          )}
          <Body>
            <Body muted>Requested: </Body>
            {new Date(challenge.createdAt).toLocaleTimeString()}
          </Body>
          {!expired && <Body muted>Expires in {left}s</Body>}
        </Card>
      )}
      {result && <Banner tone="success">{result}</Banner>}
      {error && <Banner>{error}</Banner>}
      {challenge && expired && !result && (
        <Banner tone="warning">This request {challenge.status === 'PENDING' ? 'expired' : `was ${challenge.status.toLowerCase()}`}.</Banner>
      )}
      {challenge && !expired && !result && (
        <View style={{ gap: 12 }}>
          <Button label="Approve" onPress={() => respond('APPROVE')} busy={busy === 'APPROVE'} disabled={!!busy} />
          <Button label="Deny" variant="danger" onPress={() => respond('DENY')} busy={busy === 'DENY'} disabled={!!busy} />
          <Body muted center>If you did not try to sign in, tap Deny and tell your administrator.</Body>
        </View>
      )}
    </Screen>
  );
}
