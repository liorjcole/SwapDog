import 'react-native-gesture-handler';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import React, { useEffect, useRef } from 'react';
import { NavigationContainer, NavigationContainerRef } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';
import { SuperwallProvider } from 'expo-superwall';
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

const SUPERWALL_IOS_KEY = 'pk_1CHpmKHV-l-lYGShDBz1e';

export default function App() {
  const navigationRef = useRef<NavigationContainerRef<RootStackParamList>>(null);

  useEffect(() => {
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
  }, []);

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
