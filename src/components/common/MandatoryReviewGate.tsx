import React, { useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
  BackHandler,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../../contexts/ThemeContext';
import { useReviewFlow, ReviewFlowParams } from '../../hooks/useReviewFlow';
import ReviewStepCard from './ReviewStepCard';
import { spacing, borderRadius } from '../../config/theme';

interface Props {
  /** The pending review to complete. Drives the gate's step machine. */
  data: ReviewFlowParams;
  /** Called once all reviews are submitted (and pendingReview cleared). */
  onComplete: () => void;
}

/**
 * Inescapable post-commitment review gate. Rendered as the body of a root-level
 * blocking <Modal> in MainTabNavigator so it sits above the tab bar and all
 * navigation. There is intentionally NO skip, NO close/back affordance on step
 * 0, and Android hardware back is swallowed for the gate's entire lifetime. The
 * user can only leave by submitting every step (stars > 0 AND a >=10 char note,
 * including each per-dog caregiver step).
 */
const MandatoryReviewGate: React.FC<Props> = ({ data, onComplete }) => {
  const { colors } = useTheme();
  // Read the real device top inset so the title clears the notch/status bar
  // with comfortable breathing room. SafeAreaView handles only the bottom edge
  // to avoid double-counting the top inset.
  const insets = useSafeAreaInsets();
  const flow = useReviewFlow(data);
  const {
    isLast,
    canSubmit,
    submitting,
    currentIdx,
    advanceStep,
    goToPrevStep,
    submitAllReviews,
  } = flow;

  // Swallow Android hardware back for the whole time the gate is mounted.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, []);

  const handleNext = async () => {
    if (!canSubmit || submitting) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    if (!isLast) {
      advanceStep();
      return;
    }

    const ok = await submitAllReviews();
    if (ok) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Thanks! 🎉', 'Your review has been submitted.', [
        { text: 'OK', onPress: onComplete },
      ]);
    } else {
      Alert.alert('Error', 'Something went wrong. Please try again.');
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['bottom']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* No header/back/close affordance — the gate cannot be dismissed. */}
        <ScrollView
          contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.lg }]}
          keyboardShouldPersistTaps="handled"
        >
          <ReviewStepCard flow={flow} />

          <TouchableOpacity
            style={[
              styles.nextBtn,
              { backgroundColor: colors.primary },
              !canSubmit && styles.btnDisabled,
            ]}
            onPress={handleNext}
            disabled={!canSubmit || submitting}
          >
            {submitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.nextBtnText}>{isLast ? 'Submit Review' : 'Next →'}</Text>
            )}
          </TouchableOpacity>

          {/* Back only moves to a previous step — it never exits the gate. */}
          {currentIdx > 0 && (
            <TouchableOpacity style={styles.backBtn} onPress={goToPrevStep} disabled={submitting}>
              <Text style={[styles.backBtnText, { color: colors.textSecondary }]}>← Back</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  // paddingTop is set dynamically (insets.top + spacing.lg) via inline style.
  content: { padding: spacing.lg, paddingBottom: 60 },
  nextBtn: {
    padding: spacing.md,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  btnDisabled: { opacity: 0.5 },
  nextBtnText: { fontSize: 18, fontWeight: '700', color: '#fff' },
  backBtn: { alignItems: 'center', padding: spacing.sm },
  backBtnText: { fontSize: 17, fontWeight: '600' },
});

export default MandatoryReviewGate;

