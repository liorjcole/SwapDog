import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView, Alert } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { usePlacement, useSuperwall } from '../../lib/superwall';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../../contexts/ThemeContext';
import { useAuthContext } from '../../contexts/AuthContext';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { OnboardingStackParamList } from '../../navigation/types';
import { spacing } from '../../config/theme';

const RED = '#FF2D55';

type Props = {
  navigation: NativeStackNavigationProp<OnboardingStackParamList, 'Paywall'>;
};

const PaywallScreen: React.FC<Props> = ({ navigation }) => {
  const { colors } = useTheme();
  const { user, userProfile, refreshUserProfile } = useAuthContext();
  const [dismissed, setDismissed] = useState(false);
  const [debugInfo, setDebugInfo] = useState<string>('Initializing...');
  const [showDebug, setShowDebug] = useState(false);
  const triggered = useRef(false);

  // Check Superwall configuration status
  const configError = useSuperwall((state) => state.configurationError);
  const isConfigured = useSuperwall((state) => state.isConfigured);
  const isLoading = useSuperwall((state) => state.isLoading);

  const activateAccount = async () => {
    if (!user) return;
    await updateDoc(doc(db, 'users', user.uid), {
      isOnboarded: true,
      accountStatus: 'active',
      conductAgreedAt: serverTimestamp(),
      contractSignedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await refreshUserProfile();
  };

  const { registerPlacement, state: placementState } = usePlacement({
    onPresent: (info) => {
      console.log('[Superwall] Paywall presented:', info);
      setDebugInfo('Paywall presented — waiting for user action');
    },
    onDismiss: (info, result) => {
      console.log('[Superwall] Paywall dismissed:', result);
      setDebugInfo(`Dismissed: ${JSON.stringify(result)}`);
      // User closed paywall without purchasing — show retry screen
      setDismissed(true);
    },
    onError: (err) => {
      console.error('[Superwall] Error:', err);
      setDebugInfo(`Error: ${err}`);
      setDismissed(true);
    },
    onSkip: async (reason) => {
      console.log('[Superwall] Paywall skipped:', reason);
      const reasonType = (reason as any)?.type ?? String(reason);
      setDebugInfo(`Skipped: ${reasonType}`);

      // Only activate if the user is already subscribed
      if (reasonType === 'userIsSubscribed') {
        await activateAccount();
        return;
      }

      // All other skip reasons = paywall didn't show for a config reason
      // Show the retry screen so the user isn't stuck
      setDismissed(true);
    },
  });

  const showPaywall = async () => {
    setDismissed(false);
    setDebugInfo('Calling registerPlacement...');
    try {
      await registerPlacement({
        placement: 'campaign_trigger',
        feature: async () => {
          // User subscribed! Activate account.
          setDebugInfo('Feature callback — activating account');
          await activateAccount();
        },
      });
      setDebugInfo(`registerPlacement resolved. State: ${placementState?.status ?? 'unknown'}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[Superwall] registerPlacement error:', msg);
      setDebugInfo(`registerPlacement threw: ${msg}`);
      setDismissed(true);
    }
  };

  // Auto-trigger Superwall paywall on mount (only when SDK is configured)
  useEffect(() => {
    if (triggered.current) return;
    if (configError) {
      setDebugInfo(`Config error: ${configError}`);
      setDismissed(true);
      return;
    }
    if (!isConfigured || isLoading) {
      setDebugInfo(`Waiting for Superwall SDK... (configured=${isConfigured}, loading=${isLoading})`);
      return;
    }
    triggered.current = true;
    const run = async () => {
      // Free-access window: promo code granted a 30-day paywall bypass
      if (userProfile?.freeAccessUntil && userProfile.freeAccessUntil > new Date()) {
        await activateAccount();
        return;
      }
      showPaywall();
    };
    run();
  }, [isConfigured, isLoading, configError, userProfile]);

  // If Superwall SDK failed to configure, show error with retry
  if (configError) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Text style={styles.emoji}>⚠️</Text>
        <Text style={[styles.title, { color: colors.text }]}>
          Setup Error
        </Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          Could not connect to the subscription service. Please check your internet and try again.
        </Text>
        <Text style={[styles.debugText, { color: colors.textSecondary }]}>
          {configError}
        </Text>
      </View>
    );
  }

  const activateBypass = async () => {
    try {
      setDebugInfo('Bypass tapped — activating account');
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await activateAccount();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      Alert.alert('Bypass failed', msg);
    }
  };

  // If user dismissed the paywall, show a retry screen with diagnostics
  if (dismissed) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Text style={styles.emoji}>🐾</Text>
        <Text style={[styles.title, { color: colors.text }]}>
          Subscription Required
        </Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          Subscribe to join the SwapDog community
        </Text>
        <TouchableOpacity
          style={[styles.retryBtn, { backgroundColor: RED }]}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            showPaywall();
          }}
          accessibilityLabel="Subscribe"
          accessibilityRole="button"
        >
          <Text style={styles.retryBtnText}>Subscribe</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.bypassBtn}
          onPress={activateBypass}
          accessibilityLabel="Test bypass"
          accessibilityRole="button"
        >
          <Text style={[styles.bypassBtnText, { color: colors.textSecondary }]}>Use test bypass</Text>
        </TouchableOpacity>

        {/* Debug info — tap 5x on the paw to reveal */}
        <TouchableOpacity
          style={styles.debugTap}
          onPress={() => setShowDebug((prev) => !prev)}
          activeOpacity={1}
        >
          <Text style={[styles.versionText, { color: colors.textSecondary }]}>
            SwapDog v1.0 Build 23
          </Text>
        </TouchableOpacity>

        {showDebug && (
          <ScrollView style={styles.debugContainer}>
            <Text style={[styles.debugText, { color: colors.textSecondary }]}>
              {`SDK: configured=${isConfigured}, loading=${isLoading}\n`}
              {`Placement: ${placementState?.status ?? 'idle'}\n`}
              {`Last: ${debugInfo}`}
            </Text>
          </ScrollView>
        )}
      </View>
    );
  }

  // While Superwall paywall is loading/showing, show blank + spinner
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ActivityIndicator size="large" color={RED} />
      <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
        Loading subscription...
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, paddingTop: spacing.lg },
  emoji: { fontSize: 58, marginBottom: 16 },
  title: { fontSize: 26, fontWeight: '800', marginBottom: 8, textAlign: 'center' },
  subtitle: { fontSize: 17, textAlign: 'center', marginBottom: 32, paddingHorizontal: 20 },
  retryBtn: {
    width: '100%',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  retryBtnText: { color: '#fff', fontSize: 19, fontWeight: '700' },
  loadingText: { marginTop: 16, fontSize: 16 },
  bypassBtn: { marginTop: 14, paddingVertical: 10, paddingHorizontal: 14 },
  bypassBtnText: { fontSize: 16, fontWeight: '600', textDecorationLine: 'underline' },
  debugTap: { marginTop: 24, padding: 8 },
  versionText: { fontSize: 13, opacity: 0.5 },
  debugContainer: { marginTop: 8, maxHeight: 120, width: '100%' },
  debugText: { fontSize: 13, fontFamily: 'monospace', padding: 8 },
});

export default PaywallScreen;
