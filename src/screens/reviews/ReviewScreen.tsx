import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
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
import { useAuthContext } from '../../contexts/AuthContext';
import { useReviews } from '../../hooks/useReviews';
import StarRating from '../../components/common/StarRating';
import { spacing, borderRadius } from '../../config/theme';
import { ReviewTargetType } from '../../models/types';
import KeyboardDoneBar, { DONE_ACCESSORY_ID } from '../../components/common/KeyboardDoneBar';

// ─── Param types ─────────────────────────────────────────────────────────────
export type ReviewScreenParams = {
  postId: string;
  /** 'owner' = you are the poster, review the caregiver
   *  'caregiver' = you are the sitter, review each dog then the owner */
  role: 'owner' | 'caregiver';
  otherUserId: string;
  otherUserName: string;
  dogIds: string[];
  dogNames: string[];
};

type Props = {
  navigation: NativeStackNavigationProp<any>;
  route: RouteProp<{ Review: ReviewScreenParams }, 'Review'>;
};

// ─── Step descriptor ─────────────────────────────────────────────────────────
interface ReviewStep {
  targetType: ReviewTargetType;
  dogId?: string;
  dogName?: string;
  title: string;
  subtitle: string;
  hint: string;
}

const ReviewScreen: React.FC<Props> = ({ navigation, route }) => {
  const { colors } = useTheme();
  const { userProfile } = useAuthContext();
  const { submitReview, clearPendingReview } = useReviews();
  const params = route.params;

  // ── Build the ordered list of review steps ───────────────────────────────
  const steps: ReviewStep[] = useMemo(() => {
    if (params.role === 'owner') {
      // Owner reviews the caregiver — single step
      return [
        {
          targetType: 'caregiver' as ReviewTargetType,
          title: `Rate ${params.otherUserName} as a caregiver`,
          subtitle: 'How was their care of your pup?',
          hint: 'Rate their reliability, attentiveness, and how well they cared for your dog.',
        },
      ];
    }

    // Caregiver reviews: first each dog, then the owner
    const dogSteps: ReviewStep[] = params.dogIds.map((dogId, i) => ({
      targetType: 'dog' as ReviewTargetType,
      dogId,
      dogName: params.dogNames[i] ?? 'the dog',
      title: `Rate ${params.dogNames[i] ?? 'the dog'} 🐾`,
      subtitle: '⚠️ This rating is about the dog — not the owner.',
      hint: 'Was the dog friendly, well-behaved, and as described? Any issues with temperament, energy, or special needs?',
    }));

    const ownerStep: ReviewStep = {
      targetType: 'owner' as ReviewTargetType,
      title: `Rate ${params.otherUserName} as an owner`,
      subtitle: '⚠️ This rating is about the owner — not the dog.',
      hint: 'How were their response times? Were they clear and transparent about what was needed? How reputable and reliable were they?',
    };

    return [...dogSteps, ownerStep];
  }, [params]);

  // ── State per step ───────────────────────────────────────────────────────
  const [currentIdx, setCurrentIdx] = useState(0);
  const [ratings, setRatings] = useState<number[]>(steps.map(() => 0));
  const [notes, setNotes] = useState<string[]>(steps.map(() => ''));
  const [submitting, setSubmitting] = useState(false);

  const step = steps[currentIdx];
  const isLast = currentIdx === steps.length - 1;
  const canSubmit = ratings[currentIdx] > 0;

  // ── Handlers ─────────────────────────────────────────────────────────────
  const handleNext = async () => {
    if (!canSubmit) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    if (isLast) {
      // Submit all reviews
      setSubmitting(true);
      try {
        for (let i = 0; i < steps.length; i++) {
          const s = steps[i];
          await submitReview({
            postId: params.postId,
            reviewerId: userProfile?.id ?? '',
            reviewerName: userProfile?.displayName ?? 'Anonymous',
            revieweeId: params.otherUserId,
            targetType: s.targetType,
            dogId: s.dogId,
            dogName: s.dogName,
            rating: ratings[i],
            note: notes[i].trim() || undefined,
          });
        }
        // Clear the pending review flag
        if (userProfile?.id) {
          await clearPendingReview(userProfile.id);
        }
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert('Thanks! 🎉', 'Your review has been submitted.', [
          { text: 'OK', onPress: () => navigation.goBack() },
        ]);
      } catch (err) {
        console.error('[ReviewScreen] Submit failed:', err);
        Alert.alert('Error', 'Something went wrong. Please try again.');
      } finally {
        setSubmitting(false);
      }
    } else {
      setCurrentIdx((prev) => prev + 1);
    }
  };

  const handleBack = () => {
    if (currentIdx > 0) {
      setCurrentIdx((prev) => prev - 1);
    } else {
      navigation.goBack();
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {/* Progress indicator */}
        {steps.length > 1 && (
          <Text style={[styles.progress, { color: colors.textSecondary }]}>
            Step {currentIdx + 1} of {steps.length}
          </Text>
        )}

        {/* Title + subtitle */}
        <Text style={[styles.title, { color: colors.text }]}>{step.title}</Text>
        <Text style={[styles.subtitle, { color: colors.primary }]}>{step.subtitle}</Text>

        {/* Star rating */}
        <View style={styles.starsRow}>
          <StarRating
            rating={ratings[currentIdx]}
            size={40}
            onRate={(r) => {
              const updated = [...ratings];
              updated[currentIdx] = r;
              setRatings(updated);
            }}
          />
              <KeyboardDoneBar />
</View>

        {/* Hint text */}
        <Text style={[styles.hint, { color: colors.textSecondary }]}>{step.hint}</Text>

        {/* Note input */}
        <TextInput
          style={[
            styles.noteInput,
            {
              color: colors.text,
              backgroundColor: colors.surface,
              borderColor: colors.border,
            },
          ]}
          placeholder="Add a note (optional)"
          placeholderTextColor={colors.textSecondary}
          value={notes[currentIdx]}
          onChangeText={(t) => {
            const updated = [...notes];
            updated[currentIdx] = t;
            setNotes(updated);
          }}
          multiline
          inputAccessoryViewID={DONE_ACCESSORY_ID}
          textAlignVertical="top"
          maxLength={500}
          autoCorrect
          spellCheck
          autoCapitalize="sentences"
          returnKeyType="done"
          blurOnSubmit={true}
        />

        {/* Buttons */}
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
            <Text style={styles.nextBtnText}>
              {isLast ? 'Submit Review' : 'Next →'}
            </Text>
          )}
        </TouchableOpacity>

        {currentIdx > 0 && (
          <TouchableOpacity style={styles.backBtn} onPress={handleBack}>
            <Text style={[styles.backBtnText, { color: colors.textSecondary }]}>
              ← Back
            </Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={styles.skipBtn}
          onPress={() => {
            if (userProfile?.id) clearPendingReview(userProfile.id);
            navigation.goBack();
          }}
        >
          <Text style={[styles.skipText, { color: colors.textSecondary }]}>
            Skip for now
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  content: { padding: spacing.lg, paddingTop: 40, paddingBottom: 60 },
  progress: { fontSize: 15, fontWeight: '600', textAlign: 'center', marginBottom: spacing.sm },
  title: { fontSize: 24, fontWeight: '700', textAlign: 'center', marginBottom: 6 },
  subtitle: { fontSize: 16, fontWeight: '600', textAlign: 'center', marginBottom: spacing.lg },
  starsRow: { alignItems: 'center', marginBottom: spacing.lg },
  hint: { fontSize: 15, lineHeight: 19, textAlign: 'center', marginBottom: spacing.lg, paddingHorizontal: spacing.md },
  noteInput: {
    borderWidth: 1,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    minHeight: 100,
    fontSize: 17,
    lineHeight: 21,
    marginBottom: spacing.lg,
  },
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
  skipBtn: { alignItems: 'center', padding: spacing.sm, marginTop: spacing.sm },
  skipText: { fontSize: 16 },
});

export default ReviewScreen;
