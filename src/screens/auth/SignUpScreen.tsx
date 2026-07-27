import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ScrollView, Animated } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { AuthStackParamList } from '../../navigation/types';
import { useAuth } from '../../hooks/useAuth';
import { useTheme } from '../../contexts/ThemeContext';
import { spacing, borderRadius, typography } from '../../config/theme';
import { getFriendlyAuthError } from '../../utils/authErrors';
import { validateReferralCode } from '../../hooks/useReferrals';
import { REFERRAL_STORAGE_KEY } from './ReferralCodeScreen';
import { useKeyboardScroll } from '../../hooks/useKeyboardScroll';
import { clearDeferredSignUpIntro } from '../../utils/signUpIntroFlow';

type Props = {
  navigation: NativeStackNavigationProp<AuthStackParamList, 'SignUp'>;
  route: RouteProp<AuthStackParamList, 'SignUp'>;
};

const SignUpScreen: React.FC<Props> = ({ navigation, route }) => {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { sendPhoneCode, verifyPhoneCode } = useAuth();
  const [phoneNumber, setPhoneNumber] = useState(route.params?.phoneNumber ?? '');
  const [verificationPhone, setVerificationPhone] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [showReferralField, setShowReferralField] = useState(false);
  const [referralCode, setReferralCode] = useState('');
  const [referralError, setReferralError] = useState('');
  const [checkingReferral, setCheckingReferral] = useState(false);
  const referralAnim = useRef(new Animated.Value(0)).current;
  const shouldFocusReferral = useRef(false);
  const referralInputRef = useRef<TextInput>(null);
  const {
    scrollRef,
    onScroll,
    onLayout,
    onContentSizeChange,
    refFor,
    scrollToInput,
    keyboardHeight,
  } = useKeyboardScroll();

  useEffect(() => {
    clearDeferredSignUpIntro().catch(() => undefined);
  }, []);

  useEffect(() => {
    let mounted = true;
    AsyncStorage.getItem(REFERRAL_STORAGE_KEY)
      .then((storedCode) => {
        if (!mounted || !storedCode) return;
        setReferralCode(storedCode);
        setShowReferralField(true);
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = setInterval(() => {
      setCooldown((current) => Math.max(0, current - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  useEffect(() => {
    Animated.timing(referralAnim, {
      toValue: showReferralField ? 1 : 0,
      duration: 180,
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (finished && showReferralField && shouldFocusReferral.current) {
        shouldFocusReferral.current = false;
        referralInputRef.current?.focus();
      }
    });
  }, [referralAnim, showReferralField]);

  const handleShowReferralField = () => {
    shouldFocusReferral.current = true;
    setShowReferralField(true);
  };

  const syncReferralCode = async (): Promise<boolean> => {
    const trimmed = referralCode.trim().toUpperCase();
    setReferralError('');

    if (!trimmed) {
      await AsyncStorage.removeItem(REFERRAL_STORAGE_KEY);
      return true;
    }

    setCheckingReferral(true);
    try {
      const validReferral = await validateReferralCode(trimmed);
      if (!validReferral) {
        setReferralError('Invalid or expired referral code.');
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        return false;
      }

      await AsyncStorage.setItem(REFERRAL_STORAGE_KEY, trimmed);
      setReferralCode(trimmed);
      return true;
    } catch {
      setReferralError('Could not check that referral code. Try again.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return false;
    } finally {
      setCheckingReferral(false);
    }
  };

  const handleSendCode = async () => {
    if (!phoneNumber.trim()) {
      Alert.alert('Error', 'Please enter your phone number');
      return;
    }
    setLoading(true);
    try {
      const referralReady = await syncReferralCode();
      if (!referralReady) return;
      const normalized = await sendPhoneCode(phoneNumber.trim());
      setVerificationPhone(normalized);
      setCode('');
      setCodeSent(true);
      setCooldown(30);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error: unknown) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const { title, message } = getFriendlyAuthError(error);
      Alert.alert(title, message);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async () => {
    if (!code.trim()) {
      Alert.alert('Error', 'Please enter the verification code');
      return;
    }
    setVerifying(true);
    try {
      const referralReady = await syncReferralCode();
      if (!referralReady) return;
      await verifyPhoneCode(verificationPhone || phoneNumber.trim(), code.trim(), 'signUp');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error: unknown) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const { title, message } = getFriendlyAuthError(error);
      Alert.alert(title, message);
    } finally {
      setVerifying(false);
    }
  };

  const handleBack = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('Splash');
  };

  return (
    <View style={styles.container}>
        <TouchableOpacity
          onPress={handleBack}
          accessibilityLabel="Back"
          accessibilityRole="button"
          accessibilityHint="Return to the previous screen"
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        style={[
          styles.backButton,
          styles.controlShadow,
          {
            top: insets.top + spacing.sm,
            backgroundColor: 'rgba(0,0,0,0.28)',
              borderColor: 'rgba(255,255,255,0.36)',
            },
          ]}
        >
          <Ionicons name="chevron-back" size={26} color="#FFFFFF" />
        </TouchableOpacity>
        <ScrollView
          ref={scrollRef}
          onScroll={onScroll}
          onLayout={onLayout}
          onContentSizeChange={onContentSizeChange}
          scrollEventThrottle={16}
          automaticallyAdjustKeyboardInsets={false}
          contentContainerStyle={[styles.content, { paddingBottom: spacing.lg + keyboardHeight }]}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={[styles.title, styles.textShadow, { color: '#FFFFFF' }]}>Sign up with your phone number</Text>
          <Text style={[styles.sub, styles.textShadow, { color: 'rgba(255,255,255,0.86)' }]}>
            {codeSent ? `Enter the code sent to ${verificationPhone}` : 'Join the WatchDog community'}
          </Text>

          {!codeSent ? (
            <TextInput
              style={[styles.input, styles.controlShadow, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
              placeholder="Phone number"
              placeholderTextColor={colors.textSecondary}
              value={phoneNumber}
              onChangeText={setPhoneNumber}
              keyboardType="phone-pad"
              autoCapitalize="none"
              autoComplete="tel"
              textContentType="telephoneNumber"
              accessibilityLabel="Phone number"
              accessibilityRole="none"
            />
          ) : (
            <TextInput
              style={[styles.input, styles.controlShadow, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
              placeholder="Verification code"
              placeholderTextColor={colors.textSecondary}
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              autoComplete="sms-otp"
              accessibilityLabel="Verification code"
              returnKeyType="done"
              onSubmitEditing={handleVerifyCode}
              maxLength={10}
              accessibilityRole="none"
            />
          )}

          <TouchableOpacity
            style={[styles.btn, styles.controlShadow, { backgroundColor: colors.primary, opacity: loading || verifying ? 0.7 : 1 }]}
            onPress={codeSent ? handleVerifyCode : handleSendCode}
            disabled={loading || verifying}
            accessibilityLabel={codeSent ? 'Verify code' : 'Send verification code'}
            accessibilityRole="button"
            accessibilityHint="Double tap to create your WatchDog account"
          >
            <Text style={[styles.btnText, styles.buttonTextShadow]}>
              {codeSent
                ? (verifying ? 'Verifying...' : 'Verify & Create Account')
                : (checkingReferral ? 'Checking code...' : loading ? 'Sending code...' : 'Send Code')}
            </Text>
          </TouchableOpacity>

          {codeSent ? (
            <View style={styles.codeActions}>
              <TouchableOpacity
                onPress={handleSendCode}
                disabled={loading || cooldown > 0}
                accessibilityLabel="Resend verification code"
                accessibilityRole="button"
              >
                <Text style={[styles.link, styles.textShadow, { color: cooldown > 0 ? colors.textSecondary : colors.primary }]}>
                  {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
                </Text>
              </TouchableOpacity>
            </View>
          ) : null}

          <TouchableOpacity
            onPress={handleShowReferralField}
            accessibilityLabel="Add a referral code (optional)"
            accessibilityRole="button"
            style={styles.promoLink}
          >
            <Text style={[styles.link, styles.textShadow, { color: 'rgba(255,255,255,0.78)' }]}>
              Have a referral code? <Text style={[styles.linkBold, { color: colors.primary }]}>Add it here</Text>
            </Text>
          </TouchableOpacity>

          <Animated.View
            pointerEvents={showReferralField ? 'auto' : 'none'}
            style={[
              styles.referralFieldWrap,
              {
                opacity: referralAnim,
                maxHeight: referralAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, 150],
                }),
                transform: [
                  {
                    translateY: referralAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [-6, 0],
                    }),
                  },
                ],
              },
            ]}
          >
            <View ref={refFor('referral')}>
              <TextInput
                ref={referralInputRef}
                style={[
                  styles.input,
                  styles.referralInput,
                  styles.controlShadow,
                  {
                    backgroundColor: colors.surface,
                    borderColor: referralError ? colors.error : colors.border,
                    color: colors.text,
                  },
                ]}
                placeholder="Referral code"
                placeholderTextColor={colors.textSecondary}
                value={referralCode}
                onChangeText={(value) => {
                  setReferralCode(value.toUpperCase());
                  if (referralError) setReferralError('');
                }}
                autoCapitalize="characters"
                autoCorrect={false}
                returnKeyType="done"
                onSubmitEditing={handleSendCode}
                onFocus={() => scrollToInput('referral', spacing.sm)}
                accessibilityLabel="Referral code"
                accessibilityHint="Enter an optional referral code before signing up"
              />
              {referralError ? (
                <Text style={[styles.referralError, { color: colors.error }]} accessibilityLiveRegion="polite">
                  {referralError}
                </Text>
              ) : null}
            </View>
          </Animated.View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  backButton: {
    position: 'absolute',
    left: spacing.lg,
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
    elevation: 2,
  },
  controlShadow: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.32,
    shadowRadius: 18,
    elevation: 10,
  },
  textShadow: {
    textShadowColor: 'rgba(0,0,0,0.75)',
    textShadowOffset: { width: 0, height: 3 },
    textShadowRadius: 10,
  },
  buttonTextShadow: {
    textShadowColor: 'rgba(0,0,0,0.35)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  title: { ...typography.h2, textAlign: 'center', marginBottom: spacing.xs },
  sub: { ...typography.body, textAlign: 'center', marginBottom: spacing.xl },
  input: {
    borderWidth: 1,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    fontSize: 18 },
  btn: {
    padding: spacing.md,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    marginBottom: spacing.md },
  btnText: { color: '#fff', ...typography.button },
  promoLink: { marginBottom: spacing.sm },
  referralFieldWrap: { overflow: 'hidden', marginBottom: spacing.sm },
  referralInput: { marginBottom: spacing.xs },
  referralError: { fontSize: 14, fontWeight: '600', marginBottom: spacing.sm, paddingHorizontal: 4 },
  codeActions: { gap: spacing.sm, marginBottom: spacing.md },
  link: { textAlign: 'center', fontSize: 17 },
  linkBold: { fontWeight: '700' } });

export default SignUpScreen;
