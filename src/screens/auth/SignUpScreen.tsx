import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Platform, Alert, ScrollView } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { AuthStackParamList } from '../../navigation/types';
import { useAuth } from '../../hooks/useAuth';
import { useTheme } from '../../contexts/ThemeContext';
import { spacing, borderRadius, typography } from '../../config/theme';
import { getFriendlyAuthError } from '../../utils/authErrors';

type Props = {
  navigation: NativeStackNavigationProp<AuthStackParamList, 'SignUp'>;
  route: RouteProp<AuthStackParamList, 'SignUp'>;
};

const SignUpScreen: React.FC<Props> = ({ navigation, route }) => {
  const { colors } = useTheme();
  const { signUp } = useAuth();
  const [email, setEmail] = useState(route.params?.email ?? '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const handleSignUp = async () => {
    if (!email.trim() || !password.trim() || !confirm.trim()) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }
    if (password !== confirm) {
      Alert.alert('Error', 'Passwords do not match');
      return;
    }
    if (password.length < 6) {
      Alert.alert('Error', 'Password must be at least 6 characters');
      return;
    }
    setLoading(true);
    try {
      await signUp(email.trim(), password);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error: unknown) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const { title, message } = getFriendlyAuthError(error);
      Alert.alert(title, message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        automaticallyAdjustKeyboardInsets={true} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.logo} accessibilityElementsHidden>🐾</Text>
        <Text style={[styles.title, { color: colors.text }]}>Create account</Text>
        <Text style={[styles.sub, { color: colors.textSecondary }]}>Join the WatchDog community</Text>

        <TextInput
          style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
          placeholder="Email"
          placeholderTextColor={colors.textSecondary}
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          accessibilityLabel="Email address"
          returnKeyType="next"
          blurOnSubmit={false}
          accessibilityRole="none"
        />
        <View style={styles.passwordWrap}>
          <TextInput
            style={[styles.input, styles.passwordInput, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
            placeholder="Password (min 6 characters)"
            placeholderTextColor={colors.textSecondary}
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!showPassword}
            accessibilityLabel="Password, minimum 6 characters"
            returnKeyType="next"
            blurOnSubmit={false}
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
        <View style={styles.passwordWrap}>
          <TextInput
            style={[styles.input, styles.passwordInput, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
            placeholder="Confirm Password"
            placeholderTextColor={colors.textSecondary}
            value={confirm}
            onChangeText={setConfirm}
            secureTextEntry={!showConfirm}
            accessibilityLabel="Confirm password"
            returnKeyType="done"
            onSubmitEditing={handleSignUp}
            accessibilityRole="none"
          />
          <TouchableOpacity
            style={styles.eyeBtn}
            onPress={() => setShowConfirm((v) => !v)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityLabel={showConfirm ? 'Hide confirm password' : 'Show confirm password'}
            accessibilityRole="button"
          >
            <Ionicons name={showConfirm ? 'eye-off-outline' : 'eye-outline'} size={22} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[styles.btn, { backgroundColor: colors.primary, opacity: loading ? 0.7 : 1 }]}
          onPress={handleSignUp}
          disabled={loading}
          accessibilityLabel={loading ? 'Creating account...' : 'Create account'}
          accessibilityRole="button"
          accessibilityHint="Double tap to create your WatchDog account"
        >
          <Text style={styles.btnText}>{loading ? 'Creating account...' : 'Sign Up'}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => navigation.goBack()}
          accessibilityLabel="Back to sign in"
          accessibilityRole="link"
        >
          <Text style={[styles.link, { color: colors.primary }]}>Already have an account? <Text style={styles.linkBold}>Sign In</Text></Text>
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

export default SignUpScreen;
