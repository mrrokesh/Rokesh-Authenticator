import fs from 'node:fs';
import path from 'node:path';
import type { ExpoConfig } from 'expo/config';

const BUNDLE_ID = 'com.mrrokesh.authenticator';

// Android FCM config. Locally: ./google-services.json. On EAS: a file env var named GOOGLE_SERVICES_JSON.
const googleServicesFile = process.env.GOOGLE_SERVICES_JSON ?? './google-services.json';
const hasGoogleServices = fs.existsSync(path.resolve(__dirname, googleServicesFile));
if (!hasGoogleServices) {
  console.warn(
    `[app.config] ${googleServicesFile} not found — Android builds will not receive push notifications. See frontend/.env.example.`,
  );
}

// APNs environment baked into the iOS entitlement. EAS sets EAS_BUILD_PROFILE during builds.
// Development builds (and local `expo run:ios`) use the sandbox gateway; ad-hoc (preview) and
// App Store builds use production. Must agree with backend APNS_USE_SANDBOX.
const profile = process.env.EAS_BUILD_PROFILE;
const apnsMode = !profile || profile === 'development' ? 'development' : 'production';

const config: ExpoConfig = {
  name: 'MR ROKESH Authenticator',
  slug: 'mr-rokesh-authenticator',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: 'mrrokeshauth',
  userInterfaceStyle: 'automatic',
  ios: {
    bundleIdentifier: BUNDLE_ID,
    supportsTablet: false,
    icon: './assets/expo.icon',
    infoPlist: {
      NSFaceIDUsageDescription: 'Face ID is used to unlock the authenticator and approve sign-in requests.',
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: BUNDLE_ID,
    // Keys in secure storage are device-bound; restoring a backup to another phone would break them.
    allowBackup: false,
    ...(hasGoogleServices ? { googleServicesFile } : {}),
    adaptiveIcon: {
      backgroundColor: '#E6F4FE',
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    blockedPermissions: ['android.permission.RECORD_AUDIO'],
    predictiveBackGestureEnabled: false,
  },
  plugins: [
    'expo-router',
    [
      'expo-camera',
      {
        cameraPermission: 'The camera is used to scan the enrollment QR code from your administrator.',
        microphonePermission: false,
        recordAudioAndroid: false,
        barcodeScannerEnabled: true,
      },
    ],
    ['expo-secure-store', { faceIDPermission: 'Face ID protects your authenticator keys.' }],
    ['expo-local-authentication', { faceIDPermission: 'Face ID is used to approve sign-in requests.' }],
    ['expo-notifications', { color: '#1f4fd6', defaultChannel: 'login-requests', mode: apnsMode }],
    [
      'expo-splash-screen',
      { backgroundColor: '#1f4fd6', image: './assets/images/splash-icon.png', imageWidth: 76 },
    ],
  ],
  experiments: {
    reactCompiler: true,
  },
  extra: {
    eas: { projectId: process.env.EAS_PROJECT_ID },
  },
};

export default config;
