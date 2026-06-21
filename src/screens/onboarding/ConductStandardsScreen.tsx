import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  NativeSyntheticEvent,
  NativeScrollEvent,
  ActivityIndicator,
  Alert,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { useAuthContext } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { spacing, borderRadius, typography, shadow } from '../../config/theme';

const STANDARDS = [
  {
    icon: '🐾',
    title: 'Treat Every Pet As Your Own',
    body: 'Care for each dog with the same love, attention, and responsibility you\'d give your own. Their comfort and safety come first, always.',
  },
  {
    icon: '📋',
    title: 'Follow All Care Instructions',
    body: "Every pet has unique needs. Follow the owner's feeding schedule, exercise routine, medication requirements, and behavioral guidelines precisely. When in doubt, ask.",
  },
  {
    icon: '💬',
    title: 'Communicate Proactively',
    body: 'Keep the pet owner updated with photos and check-ins. If anything changes — schedule, behavior, health — communicate immediately. No surprises.',
  },
  {
    icon: '🚨',
    title: 'Report Incidents Immediately',
    body: 'If a pet gets sick, injured, or exhibits concerning behavior, contact the owner and seek veterinary care if needed right away. Time matters.',
  },
  {
    icon: '🏠',
    title: 'Maintain a Clean & Safe Environment',
    body: 'Ensure your home or the pet\'s environment is secure, clean, and free of hazards. Check fences, gates, and doors. Remove anything dangerous.',
  },
  {
    icon: '⏰',
    title: 'Respect Pickup & Dropoff Times',
    body: "Be punctual. The pet owner is counting on you. If you're running late, communicate immediately.",
  },
  {
    icon: '🤝',
    title: 'No Subcontracting',
    body: "If you accepted a swap, you are the caretaker. Do not pass the responsibility to someone else without the owner's explicit permission.",
  },
  {
    icon: '🔒',
    title: 'Keep Information Confidential',
    body: "All personal information about pet owners, their homes, schedules, and pets is strictly confidential. Do not share with anyone outside the swap.",
  },
  {
    icon: '⚖️',
    title: 'Follow Community Conduct',
    body: 'Treat all members with respect. Harassment, discrimination, dishonesty, or any form of misconduct will result in immediate review and potential removal from the community.',
  },
];

interface ConductStandardsScreenProps {
  /** When true, hides the agree button (used for read-only profile view) */
  readOnly?: boolean;
  /** Called after successful agreement — parent handles navigation */
  onAgreed?: () => void;
}

const ConductStandardsScreen: React.FC<ConductStandardsScreenProps> = ({
  readOnly = false,
  onAgreed,
}) => {
  const { colors } = useTheme();
  const { user, refreshUserProfile } = useAuthContext();
  const scrollRef = useRef<ScrollView>(null);
  const [reachedBottom, setReachedBottom] = useState(false);
  const [checked, setChecked] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
    const paddingToBottom = 40;
    const isBottom =
      layoutMeasurement.height + contentOffset.y >= contentSize.height - paddingToBottom;
    if (isBottom && !reachedBottom) {
      setReachedBottom(true);
    }
  };

  const handleAgree = async () => {
    if (!user) return;
    setLoading(true);
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        conductAgreedAt: serverTimestamp(),
        accountStatus: 'pending_approval',
        updatedAt: serverTimestamp(),
      });
      await refreshUserProfile();
      onAgreed?.();
    } catch (err) {
      Alert.alert('Error', 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const buttonEnabled = reachedBottom && checked && !loading;

  return (
    <View style={[styles.outer, { backgroundColor: colors.background }]}>
      {/* Header — shown only in onboarding flow; nav bar title handles it in read-only/profile view */}
      {!readOnly && (
        <View style={[styles.header, { backgroundColor: colors.surface, ...shadow.sm }]}>
          <Text style={styles.headerIcon} accessibilityElementsHidden>🐾</Text>
          <Text style={[styles.headerTitle, { color: colors.text }]} accessibilityRole="header">
            Our Community Standards
          </Text>
        </View>
      )}

      <ScrollView
        ref={scrollRef}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={true}
      >
        {/* Intro */}
        <View style={[styles.introCard, { backgroundColor: colors.surface, ...shadow.sm }]}>
          <Text style={[styles.introText, { color: colors.textSecondary }]}>
            WatchDog is built on trust, love for our pets, and mutual respect. Every member of our
            community commits to these standards to ensure the safety and happiness of every pet in
            our care.
          </Text>
        </View>

        {/* Standards list */}
        {STANDARDS.map((item, index) => (
          <View
            key={index}
            style={[styles.standardCard, { backgroundColor: colors.surface, ...shadow.sm }]}
            accessible
            accessibilityLabel={`${item.title}: ${item.body}`}
          >
            <View style={styles.standardRow}>
              <Text style={styles.standardIcon} accessibilityElementsHidden>{item.icon}</Text>
              <View style={styles.standardTextGroup}>
                <Text style={[styles.standardTitle, { color: colors.text }]}>{item.title}</Text>
                <Text style={[styles.standardBody, { color: colors.textSecondary }]}>{item.body}</Text>
              </View>
            </View>
          </View>
        ))}

        {/* Agreement section — hidden in read-only mode */}
        {!readOnly && (
          <View style={[styles.agreeSection, { backgroundColor: colors.surface, ...shadow.md }]}>
            {!reachedBottom && (
              <Text style={[styles.scrollHint, { color: colors.textSecondary }]}>
                ↓ Please scroll to the bottom to continue
              </Text>
            )}

            <TouchableOpacity
              style={styles.checkRow}
              onPress={() => {
                if (!reachedBottom) return;
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setChecked((v) => !v);
              }}
              accessibilityRole="checkbox"
              accessibilityState={{ checked }}
              accessibilityLabel="I have read and agree to the WatchDog Community Standards"
            >
              <View
                style={[
                  styles.checkbox,
                  {
                    borderColor: reachedBottom ? colors.primary : colors.border,
                    backgroundColor: checked ? colors.primary : 'transparent',
                  },
                ]}
              >
                {checked && <Text style={styles.checkmark}>✓</Text>}
              </View>
              <Text
                style={[
                  styles.checkLabel,
                  { color: reachedBottom ? colors.text : colors.textSecondary },
                ]}
              >
                I have read and agree to the WatchDog Community Standards
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.agreeBtn,
                {
                  backgroundColor: buttonEnabled ? colors.primary : colors.border,
                },
              ]}
              onPress={() => {
                if (!buttonEnabled) return;
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                handleAgree();
              }}
              disabled={!buttonEnabled}
              accessibilityRole="button"
              accessibilityLabel="I Agree and Continue"
              accessibilityState={{ disabled: !buttonEnabled }}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.agreeBtnText}>I Agree &amp; Continue</Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.bottomPadding} />
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  outer: { flex: 1 },
  header: {
    alignItems: 'center',
    paddingTop: 60,
    paddingBottom: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  headerIcon: { fontSize: 42, marginBottom: spacing.xs },
  headerTitle: { ...typography.h2, textAlign: 'center' },
  scrollContent: { padding: spacing.md, paddingTop: spacing.sm },
  introCard: {
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  introText: { ...typography.body, lineHeight: 24, textAlign: 'center' },
  standardCard: {
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  standardRow: { flexDirection: 'row', alignItems: 'flex-start' },
  standardIcon: { fontSize: 28, marginRight: spacing.md, marginTop: 2 },
  standardTextGroup: { flex: 1 },
  standardTitle: { ...typography.h3, fontSize: 18, marginBottom: 4 },
  standardBody: { ...typography.bodySmall, lineHeight: 20 },
  agreeSection: {
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginTop: spacing.md,
  },
  scrollHint: {
    textAlign: 'center',
    fontSize: 15,
    marginBottom: spacing.md,
    fontStyle: 'italic',
  },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: spacing.lg },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
    marginTop: 1,
    flexShrink: 0,
  },
  checkmark: { color: '#fff', fontSize: 15, fontWeight: '700' },
  checkLabel: { flex: 1, fontSize: 16, lineHeight: 20 },
  agreeBtn: {
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  agreeBtnText: { color: '#fff', ...typography.button },
  bottomPadding: { height: 40 },
});

export default ConductStandardsScreen;
