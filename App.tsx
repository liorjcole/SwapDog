import 'react-native-gesture-handler';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { NavigationContainer, NavigationContainerRef } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';

import { AuthProvider } from './src/contexts/AuthContext';
import { ThemeProvider } from './src/contexts/ThemeContext';
import AppNavigator from './src/navigation/AppNavigator';
import linking from './src/config/linking';
import { RootStackParamList } from './src/navigation/types';
import {
  addNotificationReceivedListener,
  addNotificationResponseListener,
} from './src/services/NotificationService';
import { ErrorBoundary } from './src/components/common/ErrorBoundary';
// All expo-superwall access is routed through this guarded wrapper so no top-level
// import can crash launch when the native module is absent. See src/lib/superwall.ts.
import { SuperwallProvider } from './src/lib/superwall';
import { initializeAppSecurity } from './src/config/appCheck';

const SUPERWALL_IOS_KEY = 'pk_1CHpmKHV-l-lYGShDBz1e';

export default function App() {
  const navigationRef = useRef<NavigationContainerRef<RootStackParamList>>(null);
  const [securityReady, setSecurityReady] = useState(false);
  const [securityError, setSecurityError] = useState<string | null>(null);

  useEffect(() => {
    initializeAppSecurity()
      .then(() => setSecurityReady(true))
      .catch((error: unknown) => {
        console.error('[AppCheck] initialization failed:', error);
        setSecurityError(
          __DEV__
            ? 'This development build needs a registered Firebase App Check debug token.'
            : 'WatchDog could not verify this app installation. Please reinstall or contact support.',
        );
      });
  }, []);

  useEffect(() => {
    if (!securityReady) return undefined;
    const receivedSub = addNotificationReceivedListener((notification) => {
      console.log('Notification received:', notification?.request?.content?.title);
    });

    const responseSub = addNotificationResponseListener((response) => {
      const data = response?.notification?.request?.content?.data as
        | Record<string, string>
        | undefined;
      if (!data || !navigationRef.current) return;
      const nav = navigationRef.current;

      switch (data.type) {
        case 'new_message':
          // Open the specific chat conversation
          if (data.conversationId) {
            nav.navigate('Main', {
              screen: 'MessagesTab',
              params: {
                screen: 'Chat',
                params: {
                  conversationId: data.conversationId,
                  otherUserId: data.otherUserId ?? '',
                },
              },
            } as never);
          }
          break;

        case 'new_help_offer':
          // Open the post detail to see who offered
          if (data.postId) {
            nav.navigate('Main', {
              screen: 'RequestsTab',
              params: {
                screen: 'PostDetail',
                params: { postId: data.postId },
              },
            } as never);
          }
          break;

        case 'help_confirmed':
          // Open the post detail to see the confirmation
          if (data.postId) {
            nav.navigate('Main', {
              screen: 'RequestsTab',
              params: {
                screen: 'PostDetail',
                params: { postId: data.postId },
              },
            } as never);
          }
          break;

        case 'reminder':
          // Open the booking's Post Detail (Requests tab) for the due reminder
          if (data.postId) {
            nav.navigate('Main', {
              screen: 'RequestsTab',
              params: {
                screen: 'PostDetail',
                params: { postId: data.postId },
              },
            } as never);
          }
          break;

        case 'referral_reward':
          // Open the invite/referral screen to encourage more invites
          nav.navigate('Main', {
            screen: 'ProfileTab',
            params: { screen: 'Referral' },
          } as never);
          break;

        case 'review_prompt':
          // Open the profile tab — the pending review popup will trigger on mount
          nav.navigate('Main', {
            screen: 'ProfileTab',
            params: { screen: 'Profile' },
          } as never);
          break;

        default:
          // Fallback: if it has a conversationId, open chat (backwards compat)
          if (data.conversationId) {
            nav.navigate('Main', {
              screen: 'MessagesTab',
              params: {
                screen: 'Chat',
                params: {
                  conversationId: data.conversationId,
                  otherUserId: data.otherUserId ?? '',
                },
              },
            } as never);
          }
          break;
      }
    });

    return () => {
      receivedSub.remove();
      responseSub.remove();
    };
  }, [securityReady]);

  if (!securityReady) {
    return (
      <View style={styles.securityGate}>
        {securityError ? (
          <>
            <Text style={styles.securityTitle}>Unable to Verify App</Text>
            <Text style={styles.securityBody}>{securityError}</Text>
          </>
        ) : (
          <ActivityIndicator size="large" color="#FF2D55" />
        )}
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
    <ErrorBoundary>
      <SuperwallProvider apiKeys={{ ios: SUPERWALL_IOS_KEY }} onConfigurationError={(error) => console.error("[Superwall] Config failed:", error)}>
        <SafeAreaProvider>
          <ThemeProvider>
            <AuthProvider>
              <NavigationContainer ref={navigationRef} linking={linking}>
                <AppNavigator />
              </NavigationContainer>
            </AuthProvider>
          </ThemeProvider>
        </SafeAreaProvider>
      </SuperwallProvider>
    </ErrorBoundary>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  securityGate: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    backgroundColor: '#111111',
  },
  securityTitle: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '800',
    marginBottom: 12,
    textAlign: 'center',
  },
  securityBody: {
    color: '#CCCCCC',
    fontSize: 16,
    lineHeight: 23,
    textAlign: 'center',
  },
});
