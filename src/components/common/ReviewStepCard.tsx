import React from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity } from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';
import StarRating from './StarRating';
import KeyboardDoneBar, { DONE_ACCESSORY_ID } from './KeyboardDoneBar';
import AvatarImage from './AvatarImage';
import { spacing, borderRadius } from '../../config/theme';
import { MIN_NOTE_LENGTH, useReviewFlow } from '../../hooks/useReviewFlow';

type ReviewFlow = ReturnType<typeof useReviewFlow>;

interface Props {
  flow: ReviewFlow;
  noteRef?: (node: View | null) => void;
  onNoteFocus?: () => void;
}

/**
 * Presentational step body shared by ReviewScreen (voluntary) and
 * MandatoryReviewGate (inescapable). Renders the progress label, title,
 * subtitle, star input, hint, note field, and the inline validation helper.
 * Owns no navigation or submit chrome — each caller wires those itself.
 */
const ReviewStepCard: React.FC<Props> = ({ flow, noteRef, onNoteFocus }) => {
  const { colors } = useTheme();
  const {
    steps,
    step,
    currentIdx,
    currentRating,
    currentNote,
    canSubmit,
    trimmedLength,
    dogInteractionOptIn,
    dogInteractionResults,
    dogInteractionRatings,
    dogInteractionIssueNotes,
    setRating,
    setNote,
    setDogInteractionOptIn,
    setDogInteractionResult,
    setDogInteractionRating,
    setDogInteractionIssueNote,
  } = flow;

  if (!step) return null;

  const quickPicks = step.targetType === 'owner'
    ? ['Very responsive!', 'Clear instructions', 'Great overall']
    : step.targetType === 'caregiver'
      ? ['Very reliable!', 'Took great care', 'Great overall']
      : ['Very well behaved!', 'Sweet and easygoing', 'Great with other dogs'];

  const handleQuickPick = (phrase: string) => {
    setNote(phrase);
    if (currentRating === 0) setRating(5);
  };

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
            displayName={step.dogName ?? step.title.replace(/^Review\s+/, '')}
            size={88}
          />
        </View>
      ) : null}
      {step.subtitle ? (
        <Text style={[styles.subtitle, { color: colors.primary }]}>{step.subtitle}</Text>
      ) : null}

      {step.kind === 'dogInteractionPrompt' ? (
        <>
          <View style={styles.choiceRow}>
            <TouchableOpacity
              style={[
                styles.choiceButton,
                {
                  borderColor: dogInteractionOptIn === true ? colors.primary : colors.border,
                  backgroundColor: dogInteractionOptIn === true ? colors.primary + '18' : colors.surface,
                },
              ]}
              onPress={() => setDogInteractionOptIn(true)}
              accessibilityRole="button"
              accessibilityState={{ selected: dogInteractionOptIn === true }}
            >
              <Text style={[styles.choiceButtonText, { color: dogInteractionOptIn === true ? colors.primary : colors.text }]}>
                Yes
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.choiceButton,
                {
                  borderColor: dogInteractionOptIn === false ? colors.primary : colors.border,
                  backgroundColor: dogInteractionOptIn === false ? colors.primary + '18' : colors.surface,
                },
              ]}
              onPress={() => setDogInteractionOptIn(false)}
              accessibilityRole="button"
              accessibilityState={{ selected: dogInteractionOptIn === false }}
            >
              <Text style={[styles.choiceButtonText, { color: dogInteractionOptIn === false ? colors.primary : colors.text }]}>
                No
              </Text>
            </TouchableOpacity>
          </View>

          {dogInteractionOptIn === true && (
            <View style={styles.choiceStack}>
              {(step.dogOptions ?? []).map((dog) => {
                const result = dogInteractionResults[dog.dogId] ?? null;
                const issueRating = dogInteractionRatings[dog.dogId];
                const issueNote = dogInteractionIssueNotes[dog.dogId] ?? '';
                const issueNoteLength = issueNote.trim().length;

                return (
                  <View key={dog.dogId} style={[styles.dogInteractionCard, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                    <View style={styles.dogInteractionHeader}>
                      <AvatarImage
                        photoURL={dog.photoURL}
                        displayName={dog.dogName}
                        size={46}
                      />
                      <Text style={[styles.dogInteractionName, { color: colors.text }]}>{dog.dogName}</Text>
                    </View>
                    <View style={styles.interactionChoiceRow}>
                      <TouchableOpacity
                        style={[
                          styles.interactionPill,
                          {
                            borderColor: result === 'playedNice' ? colors.primary : colors.border,
                            backgroundColor: result === 'playedNice' ? colors.primary + '18' : colors.background,
                          },
                        ]}
                        onPress={() => setDogInteractionResult(dog.dogId, 'playedNice')}
                        accessibilityRole="button"
                        accessibilityState={{ selected: result === 'playedNice' }}
                      >
                        <Text style={[styles.interactionPillText, { color: result === 'playedNice' ? colors.primary : colors.text }]}>
                          Played nice
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[
                          styles.interactionPill,
                          {
                            borderColor: result === 'issue' ? colors.primary : colors.border,
                            backgroundColor: result === 'issue' ? colors.primary + '18' : colors.background,
                          },
                        ]}
                        onPress={() => setDogInteractionResult(dog.dogId, 'issue')}
                        accessibilityRole="button"
                        accessibilityState={{ selected: result === 'issue' }}
                      >
                        <Text style={[styles.interactionPillText, { color: result === 'issue' ? colors.primary : colors.text }]}>
                          There was an issue
                        </Text>
                      </TouchableOpacity>
                    </View>
                    {result === 'issue' && (
                      <View ref={noteRef}>
                        <Text style={[styles.issueLabel, { color: colors.textSecondary }]}>
                          How serious was it?
                        </Text>
                        <View style={styles.issueRatingRow}>
                          <TouchableOpacity
                            style={[
                              styles.zeroStarButton,
                              {
                                borderColor: issueRating === 0 ? colors.primary : colors.border,
                                backgroundColor: issueRating === 0 ? colors.primary + '18' : colors.background,
                              },
                            ]}
                            onPress={() => setDogInteractionRating(dog.dogId, 0)}
                            accessibilityRole="button"
                            accessibilityState={{ selected: issueRating === 0 }}
                            accessibilityLabel="Rate zero stars"
                          >
                            <Text style={[styles.zeroStarText, { color: issueRating === 0 ? colors.primary : colors.text }]}>
                              0 stars
                            </Text>
                          </TouchableOpacity>
                          <StarRating
                            rating={issueRating ?? 0}
                            size={28}
                            onRate={(rating) => setDogInteractionRating(dog.dogId, rating)}
                          />
                        </View>
                        {issueRating === undefined && (
                          <Text style={[styles.validationHint, { color: colors.error }]}>
                            Choose a rating
                          </Text>
                        )}
                        <TextInput
                          style={[
                            styles.noteInput,
                            styles.issueInput,
                            {
                              color: colors.text,
                              backgroundColor: colors.background,
                              borderColor: colors.border,
                            },
                          ]}
                          placeholder="What happened? (required - 10 characters min)"
                          placeholderTextColor={colors.textSecondary}
                          value={issueNote}
                          onChangeText={(text) => setDogInteractionIssueNote(dog.dogId, text)}
                          onFocus={onNoteFocus}
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
                        {issueNoteLength < MIN_NOTE_LENGTH && (
                          <Text style={[styles.validationHint, { color: colors.error }]}>
                            Explain what happened ({issueNoteLength}/{MIN_NOTE_LENGTH})
                          </Text>
                        )}
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          )}
        </>
      ) : (
        <>
      <View style={styles.starsRow}>
        <StarRating rating={currentRating} size={40} onRate={setRating} />
        <KeyboardDoneBar />
      </View>

      <Text style={[styles.hint, { color: colors.textSecondary }]}>{step.hint}</Text>

      <View style={styles.quickPickRow}>
        {quickPicks.map((phrase) => {
          const selected = currentNote.trim() === phrase;
          return (
            <TouchableOpacity
              key={phrase}
              onPress={() => handleQuickPick(phrase)}
              style={[
                styles.quickPickButton,
                {
                  borderColor: selected ? colors.primary : colors.border,
                  backgroundColor: selected ? colors.primary + '18' : colors.surface,
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel={`Use review note: ${phrase}`}
            >
              <Text style={[styles.quickPickText, { color: selected ? colors.primary : colors.text }]}>
                {phrase}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View ref={noteRef}>
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
          onFocus={onNoteFocus}
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
      </View>

      {!canSubmit && (
        <Text style={[styles.validationHint, { color: colors.error }]}>
          Add a rating and at least 10 characters
          {trimmedLength > 0 ? ` (${trimmedLength}/${MIN_NOTE_LENGTH})` : ''}
        </Text>
      )}
        </>
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
  quickPickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  quickPickButton: {
    borderWidth: 1.5,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
  },
  quickPickText: { fontSize: 14, fontWeight: '800' },
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
  choiceRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md, marginBottom: spacing.lg },
  choiceButton: {
    flex: 1,
    borderWidth: 1.5,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  choiceButtonText: { fontSize: 18, fontWeight: '800' },
  choiceStack: { gap: spacing.sm, marginTop: spacing.md, marginBottom: spacing.lg },
  interactionButton: {
    borderWidth: 1.5,
    borderRadius: borderRadius.md,
    padding: spacing.md,
  },
  interactionButtonTitle: { fontSize: 18, fontWeight: '800', marginBottom: 4 },
  interactionButtonSub: { fontSize: 14, lineHeight: 18 },
  dogInteractionCard: {
    borderWidth: 1,
    borderRadius: borderRadius.md,
    padding: spacing.md,
  },
  dogInteractionHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  dogInteractionName: { fontSize: 17, fontWeight: '800' },
  interactionChoiceRow: { flexDirection: 'row', gap: spacing.sm },
  interactionPill: {
    flex: 1,
    borderWidth: 1.5,
    borderRadius: borderRadius.full,
    paddingVertical: 9,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  interactionPillText: { fontSize: 14, fontWeight: '800', textAlign: 'center' },
  issueLabel: { fontSize: 14, fontWeight: '700', marginTop: spacing.md, marginBottom: spacing.xs },
  issueRatingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  zeroStarButton: {
    borderWidth: 1.5,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 7,
  },
  zeroStarText: { fontSize: 13, fontWeight: '800' },
  issueInput: { minHeight: 86, marginTop: spacing.sm },
});

export default ReviewStepCard;
