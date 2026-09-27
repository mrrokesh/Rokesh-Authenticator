import { useColorScheme } from 'react-native';

const light = {
  bg: '#f5f6f8',
  surface: '#ffffff',
  text: '#16181d',
  muted: '#667085',
  border: '#e4e7ec',
  accent: '#1f4fd6',
  onAccent: '#ffffff',
  danger: '#c62828',
  success: '#17803d',
  warningBg: '#fff4e0',
  warning: '#a15c00',
};

const dark: typeof light = {
  bg: '#0f1115',
  surface: '#171a21',
  text: '#e8eaef',
  muted: '#98a2b3',
  border: '#2a2f3a',
  accent: '#5b82ff',
  onAccent: '#ffffff',
  danger: '#ff6b6b',
  success: '#5fd38a',
  warningBg: '#3a2a10',
  warning: '#f5b454',
};

export type Theme = typeof light;
export const useTheme = (): Theme => (useColorScheme() === 'dark' ? dark : light);
