import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Platform,
  ActivityIndicator,
  Animated } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../navigation/types';
import { validateReferralCode } from '../../hooks/useReferrals';
import { useTheme } from '../../contexts/ThemeContext';
import { spacing, borderRadius, typography, shadow } from '../../config/theme';

export const REFERRAL_STORAGE_KEY = '@swapdog_referral_code';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Referral'>;
};

const ReferralCodeScreen: React.FC<Props> = ({ navigation }) => {
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

  const handleContinue = async () => {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) {
      setError('Please enter your referral code');
      shake();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    setLoading(true);
    setError('');

    try {
      const result = await validateReferralCode(trimmed);
      if (!result) {
        setError('Invalid or expired referral code');
        shake();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        return;
      }

      // Persist the validated code so we skip this screen on app restart
      await AsyncStorage.setItem(REFERRAL_STORAGE_KEY, trimmed);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      // Navigate to Auth (SignIn/SignUp)
      navigation.replace('Auth', { screen: 'Splash' });
    } catch {
      setError('Something went wrong. Please try again.');
      shake();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.paws} accessibilityElementsHidden>🐾</Text>
          <Text
            style={[styles.title, { color: colors.text }]}
            accessibilityRole="header"
          >
            Welcome to WatchDog
          </Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            WatchDog is an invite-only community.{'\n'}Enter your referral code to get started.
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
            REFERRAL CODE
          </Text>
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: colors.background,
                borderColor: error ? colors.error : colors.border,
                color: colors.text },
            ]}
            placeholder="e.g. SWPD2024"
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
            onSubmitEditing={handleContinue}
            accessibilityLabel="Referral code input"
            accessibilityHint="Enter the referral code you received from a WatchDog member"
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
              { backgroundColor: colors.primary, opacity: loading || !code.trim() ? 0.7 : 1 },
            ]}
            onPress={handleContinue}
            disabled={loading || !code.trim()}
            accessibilityLabel={loading ? 'Validating code…' : 'Continue'}
            accessibilityRole="button"
            accessibilityHint="Double tap to validate your referral code"
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Continue</Text>
            )}
          </TouchableOpacity>
        </Animated.View>

        <Text style={[styles.footer, { color: colors.textSecondary }]}>
          Don't have a code? Ask an existing WatchDog member to invite you.
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1 },
  content: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center' },
  header: {
    alignItems: 'center',
    marginBottom: spacing.xl },
  paws: {
    fontSize: 64,
    marginBottom: spacing.md },
  title: {
    ...typography.h1,
    textAlign: 'center',
    marginBottom: spacing.sm },
  subtitle: {
    ...typography.body,
    textAlign: 'center',
    lineHeight: 24 },
  card: {
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginBottom: spacing.lg },
  label: {
    ...typography.caption,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginBottom: spacing.sm },
  input: {
    borderWidth: 1.5,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: 4,
    textAlign: 'center',
    marginBottom: spacing.md },
  errorRow: {
    marginBottom: spacing.sm },
  errorText: {
    ...typography.bodySmall,
    textAlign: 'center',
    fontWeight: '600' },
  button: {
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52 },
  buttonText: {
    color: '#fff',
    ...typography.button,
    fontSize: 17 },
  footer: {
    ...typography.bodySmall,
    textAlign: 'center',
    lineHeight: 20 } });

export default ReferralCodeScreen;
