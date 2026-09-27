import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from './theme';

export function Screen({ children, scroll = true }: { children: ReactNode; scroll?: boolean }) {
  const t = useTheme();
  const body = <View style={styles.inner}>{children}</View>;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['bottom', 'left', 'right']}>
      {scroll ? <ScrollView contentContainerStyle={{ flexGrow: 1 }}>{body}</ScrollView> : body}
    </SafeAreaView>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const t = useTheme();
  return <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }, style]}>{children}</View>;
}

export function Title({ children }: { children: ReactNode }) {
  const t = useTheme();
  return <Text style={[styles.title, { color: t.text }]}>{children}</Text>;
}

export function Body({ children, muted, center }: { children: ReactNode; muted?: boolean; center?: boolean }) {
  const t = useTheme();
  return (
    <Text style={[styles.body, { color: muted ? t.muted : t.text, textAlign: center ? 'center' : 'left' }]}>{children}</Text>
  );
}

type Variant = 'primary' | 'secondary' | 'danger';

export function Button({
  label,
  onPress,
  variant = 'primary',
  busy,
  disabled,
}: {
  label: string;
  onPress: () => void;
  variant?: Variant;
  busy?: boolean;
  disabled?: boolean;
}) {
  const t = useTheme();
  const bg = variant === 'primary' ? t.accent : 'transparent';
  const fg = variant === 'primary' ? t.onAccent : variant === 'danger' ? t.danger : t.text;
  const border = variant === 'primary' ? t.accent : variant === 'danger' ? t.danger : t.border;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, borderColor: border, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 },
      ]}
    >
      {busy ? <ActivityIndicator color={fg} /> : <Text style={[styles.buttonText, { color: fg }]}>{label}</Text>}
    </Pressable>
  );
}

export function Banner({ children, tone = 'error' }: { children: ReactNode; tone?: 'error' | 'warning' | 'success' }) {
  const t = useTheme();
  const color = tone === 'error' ? t.danger : tone === 'warning' ? t.warning : t.success;
  return (
    <View style={[styles.banner, { borderColor: color }]}>
      <Text style={{ color, fontSize: 14 }}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  inner: { flex: 1, padding: 16, gap: 16 },
  card: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 12 },
  title: { fontSize: 22, fontWeight: '700' },
  body: { fontSize: 15, lineHeight: 21 },
  button: { minHeight: 48, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  buttonText: { fontSize: 16, fontWeight: '600' },
  banner: { borderWidth: 1, borderRadius: 12, padding: 12 },
});
