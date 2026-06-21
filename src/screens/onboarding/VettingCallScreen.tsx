import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Linking,
  Alert,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../../contexts/ThemeContext';
import { spacing, borderRadius, typography, shadow } from '../../config/theme';

const CALENDLY_URL = 'https://calendly.com/swapdog/vetting';

const VettingCallScreen: React.FC = () => {
  const { colors } = useTheme();

  const handleSchedule = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const supported = await Linking.canOpenURL(CALENDLY_URL);
      if (supported) {
        await Linking.openURL(CALENDLY_URL);
      } else {
        Alert.alert('Error', 'Could not open the scheduling link. Please visit calendly.com/swapdog/vetting directly.');
      }
    } catch {
      Alert.alert('Error', 'Could not open the scheduling link.');
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Icon + Header */}
      <View style={[styles.card, { backgroundColor: colors.surface, ...shadow.md }]}>
        <Text style={styles.calendarIcon} accessibilityElementsHidden>📅</Text>
        <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">
          One Last Step
        </Text>
        <Text style={[styles.tagline, { color: colors.primary }]}>
          Almost there! 🐾
        </Text>
      </View>

      {/* Message card */}
      <View style={[styles.messageCard, { backgroundColor: colors.surface, ...shadow.sm }]}>
        <Text style={[styles.message, { color: colors.textSecondary }]}>
          SwapDog is a selective community focused on the quality and trustworthiness of our members
          — because your pet's happiness and safety is everything.
        </Text>
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <Text style={[styles.message, { color: colors.textSecondary }]}>
          We'd love to have a brief{' '}
          <Text style={{ color: colors.primary, fontWeight: '600' }}>10-minute video call</Text> to
          get to know you, answer any questions, and make sure SwapDog is the right fit for both of
          us.
        </Text>
      </View>

      {/* Info pills */}
      <View style={styles.pillRow}>
        {['10 minutes', 'Video call', 'Friendly chat'].map((label) => (
          <View key={label} style={[styles.pill, { backgroundColor: colors.surface, ...shadow.sm }]}>
            <Text style={[styles.pillText, { color: colors.textSecondary }]}>{label}</Text>
          </View>
        ))}
      </View>

      {/* Schedule button */}
      <TouchableOpacity
        style={[styles.scheduleBtn, { backgroundColor: colors.primary }]}
        onPress={handleSchedule}
        accessibilityRole="button"
        accessibilityLabel="Schedule your vetting call"
        accessibilityHint="Opens a scheduling page in your browser"
      >
        <Text style={styles.scheduleBtnIcon} accessibilityElementsHidden>📅</Text>
        <Text style={styles.scheduleBtnText}>Schedule Your Call</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: spacing.lg,
    paddingTop: 80,
    justifyContent: 'center',
  },
  card: {
    borderRadius: borderRadius.lg,
    padding: spacing.xl,
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  calendarIcon: { fontSize: 54, marginBottom: spacing.sm },
  title: { ...typography.h2, textAlign: 'center', marginBottom: spacing.xs },
  tagline: { fontSize: 18, fontWeight: '600' },
  messageCard: {
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  message: { ...typography.body, lineHeight: 24 },
  divider: { height: 1, marginVertical: spacing.md },
  pillRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xl,
  },
  pill: {
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  pillText: { fontSize: 15, fontWeight: '500' },
  scheduleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md + 4,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  scheduleBtnIcon: { fontSize: 22 },
  scheduleBtnText: { color: '#fff', ...typography.button, fontSize: 20 },
});

export default VettingCallScreen;
