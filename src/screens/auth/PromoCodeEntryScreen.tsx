import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Animated,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AuthStackParamList } from '../../navigation/types';
import { isPromoCode, validateReferralCode } from '../../hooks/useReferrals';
import { REFERRAL_STORAGE_KEY } from './ReferralCodeScreen';
import { useTheme } from '../../contexts/ThemeContext';
import { spacing, borderRadius, typography, shadow } from '../../config/theme';

type Props = {
  navigation: NativeStackNavigationProp<AuthStackParamList, 'PromoCode'>;
};

const PromoCodeEntryScreen: React.FC<Props> = ({ navigation }) => {
  const { colors } = useTheme();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const shakeAnim = useRef(new Animated.Value(0)).current;

  const shake = () => {
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 10, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 8, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -8, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 60, useNativeDriver: true }),
    ]).start();
  };

  const handleApply = async () => {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) {
      navigation.goBack();
      return;
    }

    setLoading(true);
    setError('');

    try {
      // Accept designated promo codes without a Firestore round-trip
      const valid = isPromoCode(trimmed) || !!(await validateReferralCode(trimmed));
      if (!valid) {
        setError('Invalid or expired code. Check it and try again.');
        shake();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        return;
      }

      await AsyncStorage.setItem(REFERRAL_STORAGE_KEY, trimmed);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      navigation.goBack();
    } catch {
      setError('Something went wrong. Please try again.');
      shake();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setLoading(false);
    }
  };

  const handleSkip = () => {
    navigation.goBack();
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.paws} accessibilityElementsHidden>🐾</Text>
          <Text
            style={[styles.title, { color: colors.text }]}
            accessibilityRole="header"
          >
            Have a code?
          </Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            Enter a referral or promo code to unlock perks.{' '}
            <Text style={{ fontWeight: '600' }}>Completely optional.</Text>
          </Text>
        </View>

        {/* Input card */}
        <Animated.View
          style={[
            styles.card,
            { backgroundColor: colors.surface, transform: [{ translateX: shakeAnim }] },
            shadow.md,
          ]}
        >
          <Text style={[styles.label, { color: colors.textSecondary }]}>
            CODE
          </Text>
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: colors.background,
                borderColor: error ? colors.error : colors.border,
                color: colors.text,
              },
            ]}
            placeholder="e.g. WATCHDOGFREE"
            placeholderTextColor={colors.textSecondary}
            value={code}
            onChangeText={(val) => {
              setCode(val.toUpperCase());
              if (error) setError('');
            }}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={12}
            returnKeyType="done"
            onSubmitEditing={handleApply}
            accessibilityLabel="Promo or referral code input"
            accessibilityHint="Enter your promo or referral code, or leave blank and tap Skip"
            editable={!loading}
          />

          {error ? (
            <View style={styles.errorRow} accessibilityLiveRegion="polite">
              <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>
            </View>
          ) : null}

          <TouchableOpacity
            style={[
              styles.button,
              { backgroundColor: colors.primary, opacity: loading ? 0.7 : 1 },
            ]}
            onPress={handleApply}
            disabled={loading}
            accessibilityLabel={loading ? 'Validating code...' : code.trim() ? 'Apply code' : 'Continue'}
            accessibilityRole="button"
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>{code.trim() ? 'Apply Code' : 'Continue'}</Text>
            )}
          </TouchableOpacity>
        </Animated.View>

        <TouchableOpacity
          onPress={handleSkip}
          accessibilityLabel="Skip - I don't have a code"
          accessibilityRole="button"
        >
          <Text style={[styles.skip, { color: colors.textSecondary }]}>Skip for now</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  content: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  paws: {
    fontSize: 66,
    marginBottom: spacing.md,
  },
  title: {
    ...typography.h1,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  subtitle: {
    ...typography.body,
    textAlign: 'center',
    lineHeight: 24,
  },
  card: {
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  label: {
    ...typography.caption,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginBottom: spacing.sm,
  },
  input: {
    borderWidth: 1.5,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: 2,
    marginBottom: spacing.sm,
  },
  errorRow: {
    marginBottom: spacing.sm,
  },
  errorText: {
    fontSize: 14,
    textAlign: 'center',
  },
  button: {
    borderRadius: borderRadius.md,
    padding: spacing.md,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  buttonText: {
    color: '#fff',
    ...typography.button,
  },
  skip: {
    textAlign: 'center',
    fontSize: 16,
    marginTop: spacing.xs,
    textDecorationLine: 'underline',
  },
});

export default PromoCodeEntryScreen;

