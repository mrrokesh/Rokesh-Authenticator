import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { generateTotp, secondsRemaining } from '../services/totp';
import type { TotpConfig } from '../services/storage';
import { Card } from './ui';
import { useTheme } from './theme';

export function TotpCard({ totp }: { totp: TotpConfig }) {
  const t = useTheme();
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const code = generateTotp({ secret: totp.secret, digits: totp.digits, period: totp.period }, now);
  const left = secondsRemaining(totp.period, now);
  const formatted = `${code.slice(0, 3)} ${code.slice(3)}`;

  async function copy() {
    await Clipboard.setStringAsync(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Card>
      <Text style={{ color: t.muted, fontSize: 13 }}>
        {totp.issuer} · {totp.accountName}
      </Text>
      <Pressable onPress={copy} accessibilityLabel={`One-time code ${code}. Tap to copy.`}>
        <Text style={[styles.code, { color: left <= 5 ? t.danger : t.text }]}>{formatted}</Text>
      </Pressable>
      <View style={[styles.track, { backgroundColor: t.border }]}>
        <View style={[styles.fill, { width: `${(left / totp.period) * 100}%`, backgroundColor: left <= 5 ? t.danger : t.accent }]} />
      </View>
      <Text style={{ color: t.muted, fontSize: 13 }}>{copied ? 'Copied' : `Refreshes in ${left}s · tap code to copy`}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  code: { fontSize: 44, fontWeight: '700', letterSpacing: 4, fontVariant: ['tabular-nums'] },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
});
