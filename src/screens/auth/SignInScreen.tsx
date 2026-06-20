import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Platform, Alert, ScrollView } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { fetchSignInMethodsForEmail } from 'firebase/auth';
import { auth } from '../../config/firebase';
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
        // Could be wrong password OR non-existent account — check which one
        try {
          const methods = await fetchSignInMethodsForEmail(auth, email.trim());
          if (methods.length > 0) {
            // Account exists — wrong password
            Alert.alert('Incorrect password', 'The password you entered is incorrect. Please try again.');
          } else {
            // No account — redirect to sign-up
            Alert.alert(
              "No account found",
              "Let's create one!",
              [
                {
                  text: 'OK',
                  onPress: () => navigation.navigate('SignUp', { email: email.trim() }) },
              ],
            );
          }
        } catch {
          // Fallback if the check fails
          Alert.alert('Incorrect password', 'The password you entered is incorrect. Please try again.');
        }
      } else {
        const { title, message } = getFriendlyAuthError(error);
        Alert.alert(title, message);
      }
    } finally {
      setLoading(false);
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
  link: { textAlign: 'center', fontSize: 15 },
  linkBold: { fontWeight: '700' } });

export default SignInScreen;
