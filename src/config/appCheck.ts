import {
  CustomProvider,
  getToken as getWebAppCheckToken,
  initializeAppCheck as initializeWebAppCheck,
} from 'firebase/app-check';
import type { AppCheck } from 'firebase/app-check';
import { app } from './firebase';

type NativeFirebaseAppModule = typeof import('@react-native-firebase/app');
type NativeFirebaseAppCheckModule = typeof import('@react-native-firebase/app-check');

let initialization: Promise<void> | null = null;
let webAppCheck: AppCheck | null = null;

function loadNativeModules(): {
  firebase: NativeFirebaseAppModule;
  appCheck: NativeFirebaseAppCheckModule;
} {
  // These packages contain native modules and must stay behind guarded runtime
  // requires so an unsupported host cannot crash before React mounts.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const firebase = require('@react-native-firebase/app') as NativeFirebaseAppModule;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const appCheck = require('@react-native-firebase/app-check') as NativeFirebaseAppCheckModule;
  return { firebase, appCheck };
}

async function initializeNativeBridge(): Promise<void> {
  const { firebase, appCheck } = loadNativeModules();
  const provider = new appCheck.ReactNativeFirebaseAppCheckProvider();
  provider.configure({
    apple: {
      provider: __DEV__ ? 'debug' : 'appAttestWithDeviceCheckFallback',
    },
    android: {
      provider: __DEV__ ? 'debug' : 'playIntegrity',
    },
  });

  const nativeInstance = await appCheck.initializeAppCheck(firebase.getApp(), {
    provider,
    isTokenAutoRefreshEnabled: true,
  });
  const initialToken = await appCheck.getToken(nativeInstance, true);
  if (!initialToken.token) {
    throw new Error('Firebase App Check returned an empty token.');
  }

  const webProvider = new CustomProvider({
    getToken: async () => {
      const result = await appCheck.getToken(nativeInstance);
      if (!result.token) {
        throw new Error('Firebase App Check token refresh failed.');
      }
      return {
        token: result.token,
        // Native App Check refreshes its own token. Ask the JS SDK to request a
        // fresh native token before the default one-hour token can expire.
        expireTimeMillis: Date.now() + 50 * 60 * 1000,
      };
    },
  });

  webAppCheck = initializeWebAppCheck(app, {
    provider: webProvider,
    isTokenAutoRefreshEnabled: true,
  });
}

export function initializeAppSecurity(): Promise<void> {
  initialization ??= initializeNativeBridge();
  return initialization;
}

export async function getFirebaseAppCheckToken(): Promise<string> {
  if (!webAppCheck) {
    await initializeAppSecurity();
  }
  if (!webAppCheck) {
    throw new Error('Firebase App Check is unavailable.');
  }
  const result = await getWebAppCheckToken(webAppCheck);
  if (!result.token) {
    throw new Error('Firebase App Check returned an empty token.');
  }
  return result.token;
}
