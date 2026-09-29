import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useEnrollment } from './EnrollmentContext';
import { Banner, Body, Button, Title } from './ui';
import { useTheme } from './theme';
import { confirmUserPresence } from '../services/biometrics';

/** Re-locks the app after it has been in the background this long. */
export const RELOCK_AFTER_MS = 60_000;

/**
 * Biometric app lock. The lock is an opaque overlay on top of `children` rather than a
 * replacement for them, so the navigation stack (and whatever screen the employee was on)
 * survives a re-lock. While the app is not in the foreground the overlay also hides content
 * from the OS app-switcher snapshot.
 */
export function LockGate({ children }: { children: ReactNode }) {
  const t = useTheme();
  const { enrollment, loading } = useEnrollment();
  const [unlocked, setUnlocked] = useState(false);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [error, setError] = useState<string | null>(null);
  const backgroundedAt = useRef<number | null>(null);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      setForeground(state === 'active');
      if (state === 'background') backgroundedAt.current = Date.now();
      if (state === 'active' && backgroundedAt.current !== null) {
        if (Date.now() - backgroundedAt.current > RELOCK_AFTER_MS) setUnlocked(false);
        backgroundedAt.current = null;
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

  // Prompt automatically on launch and whenever the app re-locks (only once it's in front).
  useEffect(() => {
    if (enrollment && !unlocked && foreground) unlock();
  }, [enrollment, unlocked, foreground, unlock]);

  if (loading) return <View style={{ flex: 1, backgroundColor: t.bg }} />;

  // Nothing sensitive to protect before enrollment.
  const locked = !!enrollment && !unlocked;
  const covered = !!enrollment && (locked || !foreground);

  return (
    <View style={{ flex: 1 }}>
      <View
        style={{ flex: 1 }}
        // Hide the covered content from screen readers too.
        importantForAccessibility={covered ? 'no-hide-descendants' : 'auto'}
        accessibilityElementsHidden={covered}
      >
        {children}
      </View>
      {covered && (
        <View testID="lock-overlay" style={[StyleSheet.absoluteFill, { backgroundColor: t.bg }]}>
          {locked && foreground && (
            <SafeAreaView style={styles.lock}>
              <Title>Locked</Title>
              <Body muted>Verify it’s you to view codes and approve sign-ins.</Body>
              {error && <Banner>{error}</Banner>}
              <Button label="Unlock" onPress={unlock} />
            </SafeAreaView>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  lock: { flex: 1, justifyContent: 'center', gap: 16, padding: 16 },
});
