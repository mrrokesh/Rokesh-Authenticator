import { useState } from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { Banner, Body, Button, Card, Screen, Title } from '../components/ui';
import { useTheme } from '../components/theme';
import { takeRecoveryCodes } from '../services/enrollment';

export default function RecoveryCodes() {
  const t = useTheme();
  // Read once; the codes exist only in memory for this screen.
  const [codes] = useState(takeRecoveryCodes);
  const [copied, setCopied] = useState(false);

  const done = () => router.replace('/');

  if (!codes) {
    return (
      <Screen>
        <Title>Device enrolled</Title>
        <Body muted>Recovery codes are only shown once, right after enrollment.</Body>
        <Button label="Continue" onPress={done} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Title>Save your recovery codes</Title>
      <Body muted>
        If you lose this phone, each code can be used once to sign in. Store them somewhere safe, like a password
        manager. They will not be shown again.
      </Body>
      <Card>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
          {codes.map((c) => (
            <Text key={c} selectable style={{ color: t.text, fontSize: 17, fontFamily: 'monospace', width: '45%' }}>
              {c}
            </Text>
          ))}
        </View>
      </Card>
      {copied && <Banner tone="success">Copied. Paste them into your password manager, then clear your clipboard.</Banner>}
      <Button
        variant="secondary"
        label="Copy codes"
        onPress={async () => {
          await Clipboard.setStringAsync(codes.join('\n'));
          setCopied(true);
        }}
      />
      <Button label="I've saved them" onPress={done} />
    </Screen>
  );
}
