import React from 'react';
import {
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../../contexts/ThemeContext';
import { useReviewFlow, ReviewFlowParams } from '../../hooks/useReviewFlow';
import { useKeyboardScroll } from '../../hooks/useKeyboardScroll';
import ReviewStepCard from '../../components/common/ReviewStepCard';
import { spacing, borderRadius } from '../../config/theme';

// ─── Param types ────────────────────────────────────────────────
export type ReviewScreenParams = ReviewFlowParams;

type Props = {
  navigation: NativeStackNavigationProp<any>;
  route: RouteProp<{ Review: ReviewScreenParams }, 'Review'>;
};

/**
 * Voluntary review path (reached from the Schedule tab "Leave Review" button).
 * Shares the step machine + Firestore writes with the mandatory gate via
 * useReviewFlow, and the step UI via ReviewStepCard. Validation here is the
 * same: stars > 0 AND a >=10 character note on every step. The old "Skip for
 * now" escape (which permanently cleared pendingReview) has been removed.
 */
const ReviewScreen: React.FC<Props> = ({ navigation, route }) => {
  const { colors } = useTheme();
  const params = route.params;
  const flow = useReviewFlow(params);
  const {
    scrollRef,
    onScroll,
    onLayout,
    onContentSizeChange,
    refFor,
    scrollToInput,
  } = useKeyboardScroll();
  const {
    isLast,
    canSubmit,
    submitting,
    currentIdx,
    hasReportedDogIssue,
    advanceStep,
    goToPrevStep,
    submitAllReviews,
  } = flow;

  const handleNext = async () => {
    if (!canSubmit || submitting) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    if (!isLast) {
      advanceStep();
      return;
    }

    // Guard against orphan reviews: without a recipient, every review doc would
    // be written with an empty revieweeId and the server-side aggregation
    // (onReviewCreated) could never populate anyone's profile — yet the success
    // popup would still fire. Abort with a real error instead of a false success.
    if (!params?.otherUserId) {
      Alert.alert(
        'Error',
        'Could not submit review — missing recipient. Please try again.',
      );
      return;
    }

    const ok = await submitAllReviews();
    if (ok) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        'Thanks! 🎉',
        hasReportedDogIssue
          ? 'Your review has been submitted. We recorded the issue you flagged and will review it with care.'
          : 'Your review has been submitted.',
        [
        { text: 'OK', onPress: () => navigation.goBack() },
        ],
      );
    } else {
      Alert.alert('Error', 'Something went wrong. Please try again.');
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        ref={scrollRef}
        onScroll={onScroll}
        onLayout={onLayout}
        onContentSizeChange={onContentSizeChange}
        scrollEventThrottle={16}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <ReviewStepCard
          flow={flow}
          noteRef={refFor('reviewNote')}
          onNoteFocus={() => scrollToInput('reviewNote')}
        />

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

        {currentIdx > 0 && (
          <TouchableOpacity style={styles.backBtn} onPress={goToPrevStep} disabled={submitting}>
            <Text style={[styles.backBtnText, { color: colors.textSecondary }]}>← Back</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  content: { padding: spacing.lg, paddingTop: 40, paddingBottom: 60 },
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

export default ReviewScreen;
