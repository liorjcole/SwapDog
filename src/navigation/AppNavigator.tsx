import React, { useEffect, useState } from 'react';
import {
  Alert,
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { RootStackParamList } from './types';
import { useAuthContext } from '../contexts/AuthContext';
import AuthNavigator from './AuthNavigator';
import OnboardingNavigator from './OnboardingNavigator';
import MainTabNavigator from './MainTabNavigator';
import LegacyAccountUpgradeScreen from '../screens/auth/LegacyAccountUpgradeScreen';
import LoadingSpinner from '../components/common/LoadingSpinner';
import { registerForPushNotifications, savePushToken } from '../services/NotificationService';
import { useSuperwall } from '../lib/superwall';
import { useAuth } from '../hooks/useAuth';
import { deleteMyAccountSecure } from '../services/secureOperations';

const REFERRAL_STORAGE_KEY = '@swapdog_referral_code';

const Stack = createNativeStackNavigator<RootStackParamList>();

const AppNavigator: React.FC = () => {
  const { user, userProfile, loading } = useAuthContext();
  const { signOut } = useAuth();
  const [deletingAccount, setDeletingAccount] = useState(false);
  const identify = useSuperwall((state) => state.identify);
  const reset = useSuperwall((state) => state.reset);
  const setUserAttributes = useSuperwall((state) => state.setUserAttributes);
  const userId = user?.uid;

  // Capture referral code from deep link URL (?ref=CODE) and store for signup
  useEffect(() => {
    const captureReferralFromUrl = async () => {
      try {
        const url = await Linking.getInitialURL();
        if (url) {
          const match = url.match(/[?&]ref=([^&]+)/);
          if (match && match[1]) {
            await AsyncStorage.setItem(REFERRAL_STORAGE_KEY, match[1]);
          }
        }
      } catch {
        // Non-fatal
      }
    };
    captureReferralFromUrl();

    // Also listen for URLs while app is open
    const sub = Linking.addEventListener('url', ({ url }) => {
      const match = url.match(/[?&]ref=([^&]+)/);
      if (match && match[1]) {
        AsyncStorage.setItem(REFERRAL_STORAGE_KEY, match[1]).catch(() => {});
      }
    });
    return () => sub.remove();
  }, []);

  // Register for push notifications as soon as user is authenticated.
  // This requests iOS permission (shows the system prompt) and saves
  // the Expo push token to Firestore so Cloud Functions can send pushes.
  useEffect(() => {
    if (!userId) return;
    registerForPushNotifications()
      .then((token) => {
        if (token) return savePushToken(userId, token);
      })
      .catch((e) =>
        console.warn('[AppNavigator] push registration failed:', e)
      );
  }, [userId]);

  // Tie store purchases to the authenticated Firebase account. The signed webhook
  // uses this attribute to update only the matching server-owned entitlement.
  useEffect(() => {
    const syncIdentity = async () => {
      if (!user) {
        await reset();
        return;
      }
      await identify(user.uid);
      await setUserAttributes({ firebaseUid: user.uid });
    };
    syncIdentity().catch((error) =>
      console.warn('[AppNavigator] Superwall identity sync failed:', error)
    );
  }, [identify, reset, setUserAttributes, user]);

  if (loading) {
    return <LoadingSpinner />;
  }

  const accountStatus = userProfile?.accountStatus ?? 'pending_referral';
  const conductAgreed = !!userProfile?.conductAgreedAt;
  const contractSigned = !!userProfile?.contractSignedAt;
  const subscriptionActive =
    userProfile?.subscriptionStatus === 'active'
    && (
      !userProfile.subscriptionExpiresAt
      || userProfile.subscriptionExpiresAt > new Date()
    );
  const freeAccessActive = Boolean(
    userProfile?.freeAccessUntil && userProfile.freeAccessUntil > new Date(),
  );
  const hasAccess = subscriptionActive || freeAccessActive;
  const canEnterApp =
    userProfile?.isOnboarded === true
    && accountStatus === 'active'
    && conductAgreed
    && contractSigned
    && hasAccess;
  const hasPhoneLogin = !!user?.phoneNumber || !!userProfile?.phoneNumber;
  const needsLegacyAccountUpgrade = !!user && !!userProfile?.email && !hasPhoneLogin;
  const isRestricted = ['suspended', 'rejected', 'terminated'].includes(accountStatus);
  const confirmRestrictedAccountDeletion = () => {
    Alert.alert(
      'Delete Account?',
      'This permanently deletes your WatchDog account and associated data.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete My Account',
          style: 'destructive',
          onPress: async () => {
            setDeletingAccount(true);
            try {
              await deleteMyAccountSecure();
            } catch (error) {
              setDeletingAccount(false);
              Alert.alert(
                'Could Not Delete Account',
                error instanceof Error ? error.message : 'Please try again.',
              );
            }
          },
        },
      ],
    );
  };

  return (
    <Stack.Navigator screenOptions={{ headerShown: false, animation: 'fade' }}>
      {!user ? (
        // ── Unauthenticated: go straight to auth ──────────────────────────
        <Stack.Screen name="Auth" component={AuthNavigator} />
      ) : needsLegacyAccountUpgrade ? (
        // ── Signed in with a legacy email account: attach phone before app access
        <Stack.Screen name="LegacyAccountUpgrade" component={LegacyAccountUpgradeScreen} />
      ) : isRestricted ? (
        <Stack.Screen name="Onboarding">
          {() => (
            <View style={styles.restricted}>
              <Text style={styles.restrictedTitle}>Account unavailable</Text>
              <Text style={styles.restrictedBody}>
                This account cannot access WatchDog. Contact hi@joinwatchdog.com for help.
              </Text>
              <TouchableOpacity
                style={styles.restrictedSignOut}
                onPress={() => signOut()}
                accessibilityRole="button"
              >
                <Text style={styles.restrictedSignOutText}>Sign Out</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.restrictedDelete}
                onPress={confirmRestrictedAccountDeletion}
                disabled={deletingAccount}
                accessibilityRole="button"
                accessibilityState={{ disabled: deletingAccount }}
              >
                <Text style={styles.restrictedDeleteText}>
                  {deletingAccount ? 'Deleting Account...' : 'Delete Account'}
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </Stack.Screen>
      ) : !canEnterApp ? (
        // ── Profile, agreements, and server-confirmed access are all required.
        <Stack.Screen name="Onboarding" component={OnboardingNavigator} />
      ) : (
        <Stack.Screen name="Main" component={MainTabNavigator} />
      )}
    </Stack.Navigator>
  );
};

const styles = StyleSheet.create({
  restricted: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    backgroundColor: '#111111',
  },
  restrictedTitle: {
    color: '#FFFFFF',
    fontSize: 26,
    fontWeight: '800',
    marginBottom: 12,
    textAlign: 'center',
  },
  restrictedBody: {
    color: '#CCCCCC',
    fontSize: 17,
    lineHeight: 24,
    textAlign: 'center',
  },
  restrictedSignOut: {
    marginTop: 28,
    minWidth: 160,
    paddingHorizontal: 24,
    paddingVertical: 13,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
  },
  restrictedSignOutText: {
    color: '#111111',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  restrictedDelete: {
    marginTop: 14,
    minWidth: 160,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  restrictedDeleteText: {
    color: '#FF6B6B',
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
});

export default AppNavigator;
