import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Easing,
  Linking,
  TouchableOpacity,
} from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';
import { spacing, borderRadius, typography, shadow } from '../../config/theme';

const WaitingApprovalScreen: React.FC = () => {
  const { colors } = useTheme();

  // Pulsing animation for the status dot
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Fade in on mount
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 600,
      useNativeDriver: true,
    }).start();

    // Continuous pulsing dot
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.35,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, []);

  const handleEmail = () => {
    Linking.openURL('mailto:hello@swapdog.com');
  };

  return (
    <Animated.View style={[styles.container, { backgroundColor: colors.background, opacity: fadeAnim }]}>
      {/* Logo / main card */}
      <View style={[styles.card, { backgroundColor: colors.surface, ...shadow.md }]}>
        <Text style={styles.logo} accessibilityElementsHidden>🐾</Text>
        <Text style={[styles.appName, { color: colors.primary }]}>SwapDog</Text>

        <View style={[styles.divider, { backgroundColor: colors.border }]} />

        <Text style={[styles.heading, { color: colors.text }]} accessibilityRole="header">
          Thanks for scheduling!
        </Text>
        <Text style={[styles.body, { color: colors.textSecondary }]}>
          Once we talk to you, we will message you about the status of your application within
          24 hours.
        </Text>
      </View>

      {/* Pulsing status indicator */}
      <View style={styles.statusRow} accessible accessibilityLabel="Application under review">
        <Animated.View
          style={[
            styles.dot,
            {
              backgroundColor: colors.warning,
              transform: [{ scale: pulseAnim }],
            },
          ]}
        />
        <Text style={[styles.statusText, { color: colors.textSecondary }]}>
          Application under review
        </Text>
      </View>

      {/* Timeline card */}
      <View style={[styles.timelineCard, { backgroundColor: colors.surface, ...shadow.sm }]}>
        {[
          { icon: '✅', label: 'Referral verified' },
          { icon: '✅', label: 'Standards agreed' },
          { icon: '✅', label: 'Call scheduled' },
          { icon: '⏳', label: 'Approval pending', highlight: true },
        ].map((step, i) => (
          <View key={i} style={[styles.timelineRow, i > 0 && { marginTop: spacing.sm }]}>
            <Text style={styles.timelineIcon} accessibilityElementsHidden>{step.icon}</Text>
            <Text
              style={[
                styles.timelineLabel,
                { color: step.highlight ? colors.primary : colors.textSecondary },
                step.highlight && { fontWeight: '600' },
              ]}
            >
              {step.label}
            </Text>
          </View>
        ))}
      </View>

      {/* Contact */}
      <TouchableOpacity
        style={styles.emailBtn}
        onPress={handleEmail}
        accessibilityRole="link"
        accessibilityLabel="Email us at hello@swapdog.com"
        accessibilityHint="Opens your email app"
      >
        <Text style={[styles.emailText, { color: colors.textSecondary }]}>
          Questions? Email us at{' '}
          <Text style={{ color: colors.primary, fontWeight: '600' }}>hello@swapdog.com</Text>
        </Text>
      </TouchableOpacity>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: spacing.lg,
    justifyContent: 'center',
  },
  card: {
    borderRadius: borderRadius.lg,
    padding: spacing.xl,
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  logo: { fontSize: 54, marginBottom: spacing.xs },
  appName: { ...typography.h2, marginBottom: spacing.md },
  divider: { height: 1, width: '80%', marginBottom: spacing.md },
  heading: { ...typography.h2, textAlign: 'center', marginBottom: spacing.md },
  body: {
    ...typography.body,
    textAlign: 'center',
    lineHeight: 24,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
    gap: spacing.sm,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  statusText: { fontSize: 16, fontWeight: '500' },
  timelineCard: {
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  timelineRow: { flexDirection: 'row', alignItems: 'center' },
  timelineIcon: { fontSize: 20, marginRight: spacing.sm },
  timelineLabel: { fontSize: 17 },
  emailBtn: { alignItems: 'center', paddingVertical: spacing.md },
  emailText: { fontSize: 16, textAlign: 'center' },
});

export default WaitingApprovalScreen;
