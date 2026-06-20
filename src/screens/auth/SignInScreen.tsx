import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Platform, Alert, ScrollView } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { sendPasswordResetEmail } from 'firebase/auth';
import { auth, db } from '../../config/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { AuthStackParamList } from '../../navigation/types';
import { useAuth } from '../../hooks/useAuth';
import { useTheme } from '../../contexts/ThemeContext';
import { spacing, borderRadius, typography } from '../../config/theme';
import { getFriendlyAuthError } from '../../utils/authErrors';

type Props = {
  navigation: NativeStackNavigationProp<AuthStackParamList, 'SignIn'>;
};

const UNREGISTERED_CODES = new Set(['auth/user-not-found']);

const SignInScreen: React.FC<Props> = ({ navigation }) => {
  const { colors } = useTheme();
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSignIn = async () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }
    setLoading(true);
    try {
      await signIn(email.trim(), password);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error: unknown) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const code = (error as { code?: string })?.code ?? '';
      if (UNREGISTERED_CODES.has(code)) {
        // No account exists — redirect to sign-up with email pre-filled
        Alert.alert(
          "No account found",
          "Let's create one!",
          [
            {
              text: 'OK',
              onPress: () => navigation.navigate('SignUp', { email: email.trim() }) },
          ],
        );
      } else if (code === 'auth/invalid-credential') {
        // Could be wrong password OR non-existent account.
        // Query Firestore users collection directly — fetchSignInMethodsForEmail
        // always returns [] when Firebase Email Enumeration Protection is on.
        try {
          // Check lowercase first, then original case (covers pre-normalization accounts)
          const lowerEmail = email.trim().toLowerCase();
          const usersQuery = query(
            collection(db, 'users'),
            where('email', '==', lowerEmail)
          );
          let snap = await getDocs(usersQuery);
          if (snap.empty && lowerEmail !== email.trim()) {
            // Retry with original case for old accounts stored before normalization
            const retryQuery = query(
              collection(db, 'users'),
              where('email', '==', email.trim())
            );
            snap = await getDocs(retryQuery);
          }
          if (!snap.empty) {
            // Account exists in Firestore — it's a wrong password
            Alert.alert(
              'Incorrect password',
              'The password you entered is incorrect. Please try again or use Forgot Password below.'
            );
          } else {
            // No account in Firestore — redirect to sign-up
            Alert.alert(
              "No account found",
              "We don't have an account with that email. Let's create one!",
              [
                {
                  text: 'Create Account',
                  onPress: () => navigation.navigate('SignUp', { email: email.trim() }),
                },
                { text: 'Cancel', style: 'cancel' },
              ],
            );
          }
        } catch {
          // Firestore query failed — safest fallback is wrong password
          // (better to ask them to retry than to redirect to sign-up for an existing account)
          Alert.alert(
            'Sign in failed',
            'Please check your email and password and try again.'
          );
        }
      } else {
        const { title, message } = getFriendlyAuthError(error);
        Alert.alert(title, message);
      }
    } finally {
      setLoading(false);
    }
  };


  const handleForgotPassword = async () => {
    const trimmed = email.trim();
    if (!trimmed) {
      Alert.alert('Enter your email', 'Type your email address above, then tap Forgot Password.');
      return;
    }
    try {
      // Verify account exists in Firestore FIRST.
      // Firebase Email Enumeration Protection silently succeeds for non-existent
      // emails — sendPasswordResetEmail resolves OK but sends nothing.
      const lowerEmail = trimmed.toLowerCase();
      const usersQuery = query(
        collection(db, 'users'),
        where('email', '==', lowerEmail)
      );
      let snap = await getDocs(usersQuery);
      if (snap.empty && lowerEmail !== trimmed) {
        const retryQuery = query(
          collection(db, 'users'),
          where('email', '==', trimmed)
        );
        snap = await getDocs(retryQuery);
      }
      if (snap.empty) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        Alert.alert(
          'No account found',
          "We don't have an account with that email. Check for typos or create a new account.",
          [
            {
              text: 'Create Account',
              onPress: () => navigation.navigate('SignUp', { email: trimmed }),
            },
            { text: 'OK', style: 'cancel' },
          ],
        );
        return;
      }

      // Account confirmed in Firestore — now send the reset email.
      // Use the email stored in Firestore (exact case) for best deliverability.
      const storedEmail = snap.docs[0].data().email as string;
      await sendPasswordResetEmail(auth, storedEmail);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        'Reset link sent!',
        `We sent a password reset link to ${storedEmail}.\n\nCheck your inbox (and spam/junk folder). Open the link to set a new password, then come back and sign in.`,
      );
    } catch (error: unknown) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const code = (error as { code?: string })?.code ?? '';
      if (code === 'auth/too-many-requests') {
        Alert.alert('Too many attempts', 'Please wait a few minutes before trying again.');
      } else if (code === 'auth/invalid-email') {
        Alert.alert('Invalid email', 'Please enter a valid email address.');
      } else {
        Alert.alert('Error', 'Something went wrong. Please try again.');
      }
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        automaticallyAdjustKeyboardInsets={true} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.logo} accessibilityElementsHidden>🐾</Text>
        <Text style={[styles.title, { color: colors.text }]}>Sign in</Text>
        <Text style={[styles.sub, { color: colors.textSecondary }]}>Sign in to WatchDog</Text>

        <TextInput
          style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
          placeholder="Email"
          placeholderTextColor={colors.textSecondary}
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          returnKeyType="next"
          blurOnSubmit={false}
          accessibilityLabel="Email address"
          accessibilityRole="none"
        />
        <View style={styles.passwordWrap}>
          <TextInput
            key={showPassword ? 'pw-visible' : 'pw-hidden'}
            style={[styles.input, styles.passwordInput, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
            placeholder="Password"
            placeholderTextColor={colors.textSecondary}
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!showPassword}
            autoComplete="password"
            returnKeyType="done"
            onSubmitEditing={handleSignIn}
            accessibilityLabel="Password"
            accessibilityRole="none"
          />
          <TouchableOpacity
            style={styles.eyeBtn}
            onPress={() => setShowPassword((v) => !v)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
            accessibilityRole="button"
          >
            <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={22} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          onPress={handleForgotPassword}
          style={styles.forgotWrap}
          accessibilityLabel="Forgot password"
          accessibilityRole="link"
        >
          <Text style={[styles.forgotText, { color: colors.primary }]}>Forgot Password?</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.btn, { backgroundColor: colors.primary, opacity: loading ? 0.7 : 1 }]}
          onPress={handleSignIn}
          disabled={loading}
          accessibilityLabel={loading ? 'Signing in...' : 'Sign in'}
          accessibilityRole="button"
          accessibilityHint="Double tap to sign in to your account"
        >
          <Text style={styles.btnText}>{loading ? 'Signing in...' : 'Sign In'}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => navigation.navigate('SignUp', {})}
          accessibilityLabel="Create account"
          accessibilityRole="link"
          accessibilityHint="Go to sign up screen"
        >
          <Text style={[styles.link, { color: colors.primary }]}>Don't have an account? <Text style={styles.linkBold}>Sign Up</Text></Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flexGrow: 1, padding: spacing.lg, paddingTop: 120 },
  logo: { fontSize: 56, textAlign: 'center', marginBottom: spacing.md },
  title: { ...typography.h2, textAlign: 'center', marginBottom: spacing.xs },
  sub: { ...typography.body, textAlign: 'center', marginBottom: spacing.xl },
  input: {
    borderWidth: 1,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    fontSize: 16 },
  btn: {
    padding: spacing.md,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    marginBottom: spacing.md },
  btnText: { color: '#fff', ...typography.button },
  passwordWrap: { position: 'relative', marginBottom: spacing.md },
  passwordInput: { marginBottom: 0, paddingRight: 48 },
  eyeBtn: { position: 'absolute', right: 14, top: 0, bottom: 0, justifyContent: 'center' },
  forgotWrap: { alignItems: 'flex-end', marginBottom: spacing.md },
  forgotText: { fontSize: 14, fontWeight: '600' },
  link: { textAlign: 'center', fontSize: 15 },
  linkBold: { fontWeight: '700' } });

export default SignInScreen;
