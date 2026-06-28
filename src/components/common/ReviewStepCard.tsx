import React from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';
import StarRating from './StarRating';
import KeyboardDoneBar, { DONE_ACCESSORY_ID } from './KeyboardDoneBar';
import AvatarImage from './AvatarImage';
import { spacing, borderRadius } from '../../config/theme';
import { MIN_NOTE_LENGTH, useReviewFlow } from '../../hooks/useReviewFlow';

type ReviewFlow = ReturnType<typeof useReviewFlow>;

interface Props {
  flow: ReviewFlow;
}

/**
 * Presentational step body shared by ReviewScreen (voluntary) and
 * MandatoryReviewGate (inescapable). Renders the progress label, title,
 * subtitle, star input, hint, note field, and the inline validation helper.
 * Owns no navigation or submit chrome — each caller wires those itself.
 */
const ReviewStepCard: React.FC<Props> = ({ flow }) => {
  const { colors } = useTheme();
  const {
    steps,
    step,
    currentIdx,
    currentRating,
    currentNote,
    canSubmit,
    trimmedLength,
    setRating,
    setNote,
  } = flow;

  if (!step) return null;

  return (
    <>
      {steps.length > 1 && (
        <Text style={[styles.progress, { color: colors.textSecondary }]}>
          Step {currentIdx + 1} of {steps.length}
        </Text>
      )}

      <Text style={[styles.title, { color: colors.text }]}>{step.title}</Text>
      {step.photoURL ? (
        <View style={styles.avatarContainer}>
          <AvatarImage
            photoURL={step.photoURL}
            displayName={step.dogName ?? ''}
            size={88}
          />
        </View>
      ) : null}
      <Text style={[styles.subtitle, { color: colors.primary }]}>{step.subtitle}</Text>

      <View style={styles.starsRow}>
        <StarRating rating={currentRating} size={40} onRate={setRating} />
        <KeyboardDoneBar />
      </View>

      <Text style={[styles.hint, { color: colors.textSecondary }]}>{step.hint}</Text>

      <TextInput
        style={[
          styles.noteInput,
          {
            color: colors.text,
            backgroundColor: colors.surface,
            borderColor: colors.border,
          },
        ]}
        placeholder="Add a note (required — 10 characters min)"
        placeholderTextColor={colors.textSecondary}
        value={currentNote}
        onChangeText={setNote}
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

      {!canSubmit && (
        <Text style={[styles.validationHint, { color: colors.error }]}>
          Add a rating and at least 10 characters
          {trimmedLength > 0 ? ` (${trimmedLength}/${MIN_NOTE_LENGTH})` : ''}
        </Text>
      )}
    </>
  );
};

const styles = StyleSheet.create({
  progress: { fontSize: 15, fontWeight: '600', textAlign: 'center', marginBottom: spacing.sm },
  avatarContainer: { alignItems: 'center', marginBottom: spacing.md },
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
    marginBottom: spacing.sm,
  },
  validationHint: { fontSize: 14, fontWeight: '600', textAlign: 'center', marginBottom: spacing.md },
});

export default ReviewStepCard;

