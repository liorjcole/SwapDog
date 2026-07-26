import React, { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ScrollView } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { AuthStackParamList } from '../../navigation/types';
import { useAuth } from '../../hooks/useAuth';
import { useTheme } from '../../contexts/ThemeContext';
import { spacing, borderRadius, typography } from '../../config/theme';
import { getFriendlyAuthError } from '../../utils/authErrors';

type Props = {
  navigation: NativeStackNavigationProp<AuthStackParamList, 'SignIn'>;
};

const SignInScreen: React.FC<Props> = ({ navigation }) => {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { sendPhoneCode, verifyPhoneCode, completePhoneSignUp } = useAuth();
  const [phoneNumber, setPhoneNumber] = useState('');
  const [verificationPhone, setVerificationPhone] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = setInterval(() => {
      setCooldown((current) => Math.max(0, current - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const handleSendCode = async () => {
    if (!phoneNumber.trim()) {
      Alert.alert('Error', 'Please enter your phone number');
      return;
    }
    setLoading(true);
    try {
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

  const handleCreateAccount = async (verifiedPhone: string, signupTicket: string) => {
    setVerifying(true);
    try {
      await completePhoneSignUp(verifiedPhone, signupTicket);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error: unknown) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const { title, message } = getFriendlyAuthError(error);
      Alert.alert(title, message);
    } finally {
      setVerifying(false);
    }
  };

  const handleVerifyCode = async () => {
    if (!code.trim()) {
      Alert.alert('Error', 'Please enter the verification code');
      return;
    }
    setVerifying(true);
    try {
      const result = await verifyPhoneCode(verificationPhone || phoneNumber.trim(), code.trim(), 'signIn');
      if (result.status === 'verifiedNoAccount') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert(
          'No account found',
          "That phone number is verified. Create a new WatchDog account with it?",
          [
            {
              text: 'Create Account',
              onPress: () => {
                void handleCreateAccount(result.phoneNumber, result.signupTicket);
              },
            },
            { text: 'Cancel', style: 'cancel' },
          ],
        );
        return;
      }
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
        automaticallyAdjustKeyboardInsets={false} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={[styles.title, styles.headingShadow, { color: '#FFFFFF' }]}>Sign in</Text>
        <Text style={[styles.sub, styles.headingShadow, { color: 'rgba(255,255,255,0.96)' }]}>
          {codeSent ? `Enter the code sent to ${verificationPhone}` : 'Sign in with your phone number'}
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
            returnKeyType="done"
            onSubmitEditing={handleVerifyCode}
            maxLength={10}
            accessibilityLabel="Verification code"
            accessibilityRole="none"
          />
        )}

        <TouchableOpacity
          style={[styles.btn, styles.controlShadow, { backgroundColor: colors.primary, opacity: loading || verifying ? 0.7 : 1 }]}
          onPress={codeSent ? handleVerifyCode : handleSendCode}
          disabled={loading || verifying}
          accessibilityLabel={codeSent ? 'Verify code' : 'Send verification code'}
          accessibilityRole="button"
          accessibilityHint="Double tap to sign in to your account"
        >
          <Text style={[styles.btnText, styles.buttonTextShadow]}>
            {codeSent
              ? (verifying ? 'Verifying...' : 'Verify & Sign In')
              : (loading ? 'Sending code...' : 'Send Code')}
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
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 1,
    shadowRadius: 40,
    elevation: 24,
  },
  textShadow: {
    textShadowColor: '#000000',
    textShadowOffset: { width: 0, height: 8 },
    textShadowRadius: 30,
  },
  headingShadow: {
    textShadowColor: '#000000',
    textShadowOffset: { width: 0, height: 10 },
    textShadowRadius: 36,
  },
  buttonTextShadow: {
    textShadowColor: '#000000',
    textShadowOffset: { width: 0, height: 4 },
    textShadowRadius: 14,
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
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.42)',
    alignItems: 'center',
    marginBottom: spacing.md },
  btnText: { color: '#fff', ...typography.button },
  codeActions: { gap: spacing.sm, marginBottom: spacing.md },
  link: { textAlign: 'center', fontSize: 17 },
  linkBold: { fontWeight: '700' } });

export default SignInScreen;
