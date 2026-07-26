import React, { useEffect, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Haptics from 'expo-haptics';
import { AuthStackParamList } from '../../navigation/types';
import { useAuth } from '../../hooks/useAuth';
import { useAuthContext } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { borderRadius, spacing, typography } from '../../config/theme';
import { getFriendlyAuthError } from '../../utils/authErrors';

type LegacyUpgradeNavigation = NativeStackNavigationProp<AuthStackParamList, 'LegacyAccountUpgrade'>;

function getLegacyUpgradeError(error: unknown): { title: string; message: string } {
  const code = (error as { code?: string })?.code ?? '';
  if (code.startsWith('auth/')) {
    return {
      title: 'Old Login Not Found',
      message: 'Check the email and password from your old TestFlight login, then try again.',
    };
  }
  if (code === 'functions/already-exists') {
    return {
      title: 'Phone Number Already Used',
      message: 'That phone number is already attached to another WatchDog account.',
    };
  }
  return getFriendlyAuthError(error);
}

const LegacyAccountUpgradeScreen: React.FC = () => {
  const navigation = useNavigation<LegacyUpgradeNavigation>();
  const { colors } = useTheme();
  const { user, userProfile, refreshUserProfile } = useAuthContext();
  const {
    sendPhoneCode,
    verifyPhoneForAccountUpgrade,
    attachPhoneToCurrentUser,
    attachVerifiedPhoneToEmailAccount,
    signOut,
  } = useAuth();

  const isSignedInLegacyAccount = !!user && !userProfile?.phoneNumber;
  const [phoneNumber, setPhoneNumber] = useState('');
  const [verificationPhone, setVerificationPhone] = useState('');
  const [code, setCode] = useState('');
  const [oldEmail, setOldEmail] = useState(user?.email ?? userProfile?.email ?? '');
  const [oldPassword, setOldPassword] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [verifiedUpgrade, setVerifiedUpgrade] = useState<{
    phoneNumber: string;
    signupTicket: string;
  } | null>(null);

  useEffect(() => {
    if (oldEmail || !user?.email) return;
    setOldEmail(user.email);
  }, [oldEmail, user?.email]);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = setInterval(() => {
      setCooldown((current) => Math.max(0, current - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const handleSendCode = async () => {
    if (!phoneNumber.trim()) {
      Alert.alert('Phone Number Required', 'Enter the phone number you want to use for WatchDog.');
      return;
    }

    setSending(true);
    try {
      const normalized = await sendPhoneCode(phoneNumber.trim());
      setVerificationPhone(normalized);
      setCode('');
      setVerifiedUpgrade(null);
      setCodeSent(true);
      setCooldown(30);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error: unknown) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const { title, message } = getFriendlyAuthError(error);
      Alert.alert(title, message);
    } finally {
      setSending(false);
    }
  };

  const handleUpgrade = async () => {
    if (!code.trim()) {
      Alert.alert('Code Required', 'Enter the verification code we texted you.');
      return;
    }
    if (!isSignedInLegacyAccount && (!oldEmail.trim() || !oldPassword)) {
      Alert.alert('Old Login Required', 'Enter your old TestFlight email and password first.');
      return;
    }

    setSubmitting(true);
    try {
      const phone = verificationPhone || phoneNumber.trim();
      if (isSignedInLegacyAccount) {
        const verified = await verifyPhoneForAccountUpgrade(phone, code.trim());
        await attachPhoneToCurrentUser(verified.phoneNumber, verified.signupTicket);
        await refreshUserProfile();
      } else {
        const verified = verifiedUpgrade?.phoneNumber === phone
          ? verifiedUpgrade
          : await verifyPhoneForAccountUpgrade(phone, code.trim());
        setVerifiedUpgrade(verified);
        await attachVerifiedPhoneToEmailAccount(
          oldEmail.trim(),
          oldPassword,
          verified.phoneNumber,
          verified.signupTicket,
        );
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error: unknown) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const { title, message } = getLegacyUpgradeError(error);
      Alert.alert(title, message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch {
      Alert.alert('Oops!', 'Could not sign out. Please try again.');
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        automaticallyAdjustKeyboardInsets={false}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.headerRow}>
          {navigation.canGoBack() ? (
            <TouchableOpacity
              onPress={() => navigation.goBack()}
              accessibilityRole="button"
              accessibilityLabel="Go back"
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Text style={[styles.backText, { color: colors.primary }]}>Back</Text>
            </TouchableOpacity>
          ) : (
            <View />
          )}
        </View>

        <Text style={[styles.eyebrow, { color: colors.primary }]}>Login upgrade</Text>
        <Text style={[styles.title, { color: colors.text }]}>Reinstate your account</Text>
        <Text style={[styles.sub, { color: colors.textSecondary }]}>
          {isSignedInLegacyAccount
            ? 'We found your old TestFlight account. Verify a phone number to keep using it.'
            : "We've upgraded our login process. Enter your phone number, then confirm your old TestFlight login so we can attach everything to the same account."}
        </Text>

        <View style={styles.section}>
          <Text style={[styles.label, { color: colors.text }]}>Phone number</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
            placeholder="Phone number"
            placeholderTextColor={colors.textSecondary}
            value={phoneNumber}
            onChangeText={(value) => {
              setPhoneNumber(value);
              setVerifiedUpgrade(null);
            }}
            keyboardType="phone-pad"
            autoCapitalize="none"
            autoComplete="tel"
            textContentType="telephoneNumber"
            editable={!codeSent}
            accessibilityLabel="Phone number"
            accessibilityRole="none"
          />
          <TouchableOpacity
            style={[
              styles.btn,
              { backgroundColor: colors.primary, opacity: sending || submitting ? 0.7 : 1 },
            ]}
            onPress={handleSendCode}
            disabled={sending || submitting || cooldown > 0}
            accessibilityLabel={codeSent ? 'Resend verification code' : 'Send verification code'}
            accessibilityRole="button"
          >
            <Text style={styles.btnText}>
              {sending
                ? 'Sending code...'
                : codeSent && cooldown > 0
                  ? `Resend in ${cooldown}s`
                  : codeSent
                    ? 'Resend Code'
                    : 'Send Code'}
            </Text>
          </TouchableOpacity>
        </View>

        {codeSent ? (
          <View style={styles.section}>
            <Text style={[styles.label, { color: colors.text }]}>Verification code</Text>
            <Text style={[styles.helper, { color: colors.textSecondary }]}>
              Sent to {verificationPhone}
            </Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
              placeholder="Verification code"
              placeholderTextColor={colors.textSecondary}
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              autoComplete="sms-otp"
              returnKeyType="done"
              onSubmitEditing={handleUpgrade}
              maxLength={10}
              accessibilityLabel="Verification code"
              accessibilityRole="none"
            />

            {!isSignedInLegacyAccount ? (
              <>
                <Text style={[styles.label, { color: colors.text }]}>Old TestFlight email</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
                  placeholder="Email from your old login"
                  placeholderTextColor={colors.textSecondary}
                  value={oldEmail}
                  onChangeText={setOldEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoComplete="email"
                  textContentType="emailAddress"
                  accessibilityLabel="Old TestFlight email"
                  accessibilityRole="none"
                />

                <Text style={[styles.label, { color: colors.text }]}>Old password</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
                  placeholder="Password"
                  placeholderTextColor={colors.textSecondary}
                  value={oldPassword}
                  onChangeText={setOldPassword}
                  secureTextEntry
                  autoCapitalize="none"
                  autoComplete="password"
                  textContentType="password"
                  accessibilityLabel="Old password"
                  accessibilityRole="none"
                />
              </>
            ) : null}

            <TouchableOpacity
              style={[
                styles.btn,
                { backgroundColor: colors.primary, opacity: submitting || sending ? 0.7 : 1 },
              ]}
              onPress={handleUpgrade}
              disabled={submitting || sending}
              accessibilityLabel="Upgrade login"
              accessibilityRole="button"
            >
              <Text style={styles.btnText}>{submitting ? 'Upgrading...' : 'Upgrade Login'}</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {isSignedInLegacyAccount ? (
          <TouchableOpacity
            onPress={handleSignOut}
            accessibilityRole="button"
            accessibilityLabel="Use a different old account"
          >
            <Text style={[styles.link, { color: colors.primary }]}>Use a different old account</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            onPress={() => navigation.navigate('SignIn')}
            accessibilityRole="link"
            accessibilityLabel="Back to phone sign in"
          >
            <Text style={[styles.link, { color: colors.primary }]}>Use phone sign in instead</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flexGrow: 1, padding: spacing.lg, paddingTop: 58 },
  headerRow: {
    minHeight: 32,
    marginBottom: spacing.lg,
    justifyContent: 'center',
  },
  backText: { fontSize: 17, fontWeight: '700' },
  eyebrow: {
    ...typography.caption,
    fontWeight: '800',
    letterSpacing: 0,
    textTransform: 'uppercase',
    marginBottom: spacing.xs,
  },
  title: { ...typography.h2, marginBottom: spacing.sm },
  sub: { ...typography.body, marginBottom: spacing.xl, lineHeight: 24 },
  section: { marginBottom: spacing.lg },
  label: { fontSize: 16, fontWeight: '700', marginBottom: spacing.xs },
  helper: { ...typography.caption, marginBottom: spacing.sm },
  input: {
    borderWidth: 1,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    fontSize: 18,
  },
  btn: {
    padding: spacing.md,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  btnText: { color: '#fff', ...typography.button },
  link: { textAlign: 'center', fontSize: 17, fontWeight: '700' },
});

export default LegacyAccountUpgradeScreen;
