import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Haptics from 'expo-haptics';
import { isSuperwallAvailable, usePlacement, useSuperwall } from '../../lib/superwall';
import { useTheme } from '../../contexts/ThemeContext';
import { useAuthContext } from '../../contexts/AuthContext';
import { OnboardingStackParamList } from '../../navigation/types';
import { spacing } from '../../config/theme';

const RED = '#FF2D55';

type Props = {
  navigation: NativeStackNavigationProp<OnboardingStackParamList, 'Paywall'>;
};

const getSkipReasonType = (reason: unknown): string => {
  if (reason && typeof reason === 'object' && 'type' in reason) {
    const type = (reason as { type?: unknown }).type;
    if (typeof type === 'string') return type;
  }
  return String(reason);
};

const PaywallScreen: React.FC<Props> = ({ navigation }) => {
  const { colors } = useTheme();
  const { userProfile } = useAuthContext();
  const [dismissed, setDismissed] = useState(false);
  const triggered = useRef(false);

  const configError = useSuperwall((state) => state.configurationError);
  const isConfigured = useSuperwall((state) => state.isConfigured);
  const isLoading = useSuperwall((state) => state.isLoading);

  const continueToAgreements = useCallback(() => {
    navigation.navigate('ConductStandards');
  }, [navigation]);

  const { registerPlacement } = usePlacement({
    onDismiss: () => setDismissed(true),
    onError: (error) => {
      console.error('[Superwall] Paywall error:', error);
      setDismissed(true);
    },
    onSkip: (reason) => {
      if (getSkipReasonType(reason) === 'userIsSubscribed') {
        continueToAgreements();
      } else {
        setDismissed(true);
      }
    },
  });

  const showPaywall = useCallback(async () => {
    setDismissed(false);
    try {
      await registerPlacement({
        placement: 'campaign_trigger',
        feature: async () => {
          // The signed Superwall webhook is the source of truth for entitlement.
          continueToAgreements();
        },
      });
    } catch (error) {
      console.error('[Superwall] registerPlacement failed:', error);
      setDismissed(true);
    }
  }, [continueToAgreements, registerPlacement]);

  useEffect(() => {
    if (triggered.current) return;
    if (configError || !isSuperwallAvailable) {
      triggered.current = true;
      setDismissed(true);
      return;
    }
    if (!isConfigured || isLoading) return;

    triggered.current = true;
    if (userProfile?.freeAccessUntil && userProfile.freeAccessUntil > new Date()) {
      continueToAgreements();
      return;
    }
    showPaywall();
  }, [
    configError,
    continueToAgreements,
    isConfigured,
    isLoading,
    showPaywall,
    userProfile?.freeAccessUntil,
  ]);

  useEffect(() => {
    if (configError || isConfigured || !isSuperwallAvailable) return undefined;
    const timeout = setTimeout(() => {
      if (!triggered.current) setDismissed(true);
    }, 8000);
    return () => clearTimeout(timeout);
  }, [configError, isConfigured]);

  if (dismissed || configError) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Text style={styles.emoji} accessibilityElementsHidden>🐾</Text>
        <Text style={[styles.title, { color: colors.text }]}>Subscription Required</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          Start your membership to continue.
        </Text>
        <TouchableOpacity
          style={styles.retryBtn}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            showPaywall();
          }}
          accessibilityLabel="Open subscription options"
          accessibilityRole="button"
        >
          <Text style={styles.retryBtnText}>View Options</Text>
        </TouchableOpacity>
      </View>
    );
  }

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
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    paddingTop: spacing.lg,
  },
  emoji: { fontSize: 58, marginBottom: 16 },
  title: { fontSize: 26, fontWeight: '800', marginBottom: 8, textAlign: 'center' },
  subtitle: { fontSize: 17, textAlign: 'center', marginBottom: 32 },
  retryBtn: {
    width: '100%',
    paddingVertical: 16,
    borderRadius: 8,
    alignItems: 'center',
    backgroundColor: RED,
  },
  retryBtnText: { color: '#fff', fontSize: 19, fontWeight: '700' },
  loadingText: { marginTop: 16, fontSize: 16 },
});

export default PaywallScreen;
