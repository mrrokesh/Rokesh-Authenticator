const raw = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '');

if (!raw) {
  throw new Error('EXPO_PUBLIC_API_URL is not set — copy frontend/.env.example to .env');
}
if (!__DEV__ && !raw.startsWith('https://')) {
  throw new Error('EXPO_PUBLIC_API_URL must use https:// in release builds');
}

export const API_URL = raw;
