import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, Alert, ScrollView,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Haptics from 'expo-haptics';
import { AuthStackParamList } from '../../navigation/types';
import { useAuth } from '../../hooks/useAuth';
import { useTheme } from '../../contexts/ThemeContext';
import { spacing, borderRadius, typography } from '../../config/theme';
import { getFriendlyAuthError } from '../../utils/authErrors';

type Props = {
  navigation: NativeStackNavigationProp<AuthStackParamList, 'SignIn'>;
};

const UNREGISTERED_CODES = new Set(['auth/user-not-found', 'auth/invalid-credential']);

const SignInScreen: React.FC<Props> = ({ navigation }) => {
  const { colors } = useTheme();
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
              onPress: () => navigation.navigate('SignUp', { email: email.trim() }),
            },
          ],
        );
      } else {
        const { title, message } = getFriendlyAuthError(error);
        Alert.alert(title, message);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 10 : 0}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
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
        <TextInput
          style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
          placeholder="Password"
          placeholderTextColor={colors.textSecondary}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="password"
          returnKeyType="done"
          onSubmitEditing={handleSignIn}
          accessibilityLabel="Password"
          accessibilityRole="none"
        />

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
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flexGrow: 1, padding: spacing.lg, justifyContent: 'center' },
  logo: { fontSize: 56, textAlign: 'center', marginBottom: spacing.md },
  title: { ...typography.h2, textAlign: 'center', marginBottom: spacing.xs },
  sub: { ...typography.body, textAlign: 'center', marginBottom: spacing.xl },
  input: {
    borderWidth: 1,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    fontSize: 16,
  },
  btn: {
    padding: spacing.md,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  btnText: { color: '#fff', ...typography.button },
  link: { textAlign: 'center', fontSize: 15 },
  linkBold: { fontWeight: '700' },
});

export default SignInScreen;
