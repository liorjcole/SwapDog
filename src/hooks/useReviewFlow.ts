import { useMemo, useState } from 'react';
import { useAuthContext } from '../contexts/AuthContext';
import { useReviews } from './useReviews';
import { ReviewTargetType } from '../models/types';

// Minimum characters required in the note on EVERY review step.
export const MIN_NOTE_LENGTH = 10;

// ─── Params shared by the voluntary ReviewScreen and the mandatory gate ──────
export interface ReviewFlowParams {
  postId: string;
  /** 'owner' = you posted it, review the caregiver
   *  'caregiver' = you sat, review the owner + the dogs on the post */
  role: 'owner' | 'caregiver';
  otherUserId: string;
  otherUserName: string;
  /** Dogs specifically listed on the post. These are automatically present. */
  dogIds: string[];
  dogNames: string[];
  /** Primary photo URL for each dog — index-aligned with dogIds. Undefined renders no avatar. */
  dogPhotoURLs?: string[];
  /** Other user's dogs that were not necessarily part of the post. Asked as an optional follow-up. */
  otherUserDogOptions?: { dogId: string; dogName: string; photoURL?: string }[];
  /** Profile photo URL of the other user being reviewed (owner in caregiver flow). */
  otherUserPhotoURL?: string;
}

export interface ReviewStep {
  kind: 'rating' | 'dogInteractionPrompt';
  targetType?: ReviewTargetType;
  dogId?: string;
  dogName?: string;
  dogOptions?: { dogId: string; dogName: string; photoURL?: string }[];
  /** Identity photo shown under the step title. Undefined = no avatar rendered. */
  photoURL?: string;
  title: string;
  subtitle: string;
  hint: string;
}

/**
 * Single source of truth for the post-commitment review flow: the ordered step
 * machine, per-step state, validation, optional dog-interaction notes, and the
 * Firestore writes (submitReview per step + clearPendingReview).
 *
 * Both ReviewScreen (voluntary path) and MandatoryReviewGate (inescapable gate)
 * consume this hook so the steps and writes never diverge. Each caller owns only
 * its own chrome and post-submit navigation.
 */
export const useReviewFlow = (params: ReviewFlowParams) => {
  const { userProfile } = useAuthContext();
  const { submitReview, clearPendingReview } = useReviews();

  // ── Build the ordered list of review steps ───────────────────────────────
  const steps: ReviewStep[] = useMemo(() => {
    const postDogIds = params.dogIds ?? [];
    const postDogNames = params.dogNames ?? [];
    const postDogPhotoURLs = params.dogPhotoURLs ?? [];
    const postDogIdSet = new Set(postDogIds);
    const optionalDogOptions = (params.otherUserDogOptions ?? []).filter((dog) => (
      dog.dogId && !postDogIdSet.has(dog.dogId)
    ));
    const caredDogLabel = postDogNames.length > 1
      ? postDogNames.join(' & ')
      : postDogNames[0] ?? 'your pup';

    const buildDogInteractionPrompt = (): ReviewStep | null => {
      if (optionalDogOptions.length === 0) return null;
      return {
        kind: 'dogInteractionPrompt',
        title: `Did ${caredDogLabel} spend time with ${params.otherUserName}'s pups?`,
        subtitle: '',
        hint: '',
        dogOptions: optionalDogOptions,
      };
    };

    if (params.role === 'owner') {
      // Owner reviews the caregiver. If the caregiver's dogs were present, the
      // owner can optionally add dog-behavior notes too.
      const caregiverStep: ReviewStep = {
        kind: 'rating',
        targetType: 'caregiver' as ReviewTargetType,
        photoURL: params.otherUserPhotoURL,
        title: `Review ${params.otherUserName}`,
        subtitle: 'How was their care of your pup?',
        hint: 'Rate their reliability, attentiveness, and how well they cared for your dog.',
      };
      const promptStep = buildDogInteractionPrompt();
      return promptStep ? [caregiverStep, promptStep] : [caregiverStep];
    }

    // Caregiver reviews the owner, then directly reviews the dogs that were on
    // the post because those dogs are known to have been present.
    const ownerStep: ReviewStep = {
      kind: 'rating',
      targetType: 'owner' as ReviewTargetType,
      photoURL: params.otherUserPhotoURL,
      title: `Review ${params.otherUserName}`,
      subtitle: '⚠️ This rating is about the owner — not the dog.',
      hint: 'How were their response times? Were they clear and transparent about what was needed? How reputable and reliable were they?',
    };

    const dogRatingSteps: ReviewStep[] = postDogIds.map((dogId, i) => {
      const dogName = postDogNames[i] ?? 'the dog';
      return {
        kind: 'rating',
        targetType: 'dog' as ReviewTargetType,
        dogId,
        dogName,
        photoURL: postDogPhotoURLs[i],
        title: `Review ${dogName}`,
        subtitle: `How was ${dogName} during care?`,
        hint: 'Rate their behavior, friendliness, and how easy they were to care for.',
      };
    });

    const promptStep = buildDogInteractionPrompt();
    return promptStep ? [ownerStep, ...dogRatingSteps, promptStep] : [ownerStep, ...dogRatingSteps];
  }, [params]);

  // ── Per-step state ───────────────────────────────────────────────────────
  const [currentIdx, setCurrentIdx] = useState(0);
  const [ratings, setRatings] = useState<number[]>(() => steps.map(() => 0));
  const [notes, setNotes] = useState<string[]>(() => steps.map(() => ''));
  const [dogInteractionOptIn, setDogInteractionOptIn] = useState<boolean | null>(null);
  const [dogInteractionResults, setDogInteractionResults] = useState<Record<string, 'playedNice' | 'issue'>>({});
  const [dogInteractionRatings, setDogInteractionRatings] = useState<Record<string, number>>({});
  const [dogInteractionIssueNotes, setDogInteractionIssueNotes] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const step = steps[currentIdx];
  const isLast = currentIdx === steps.length - 1;
  const currentRating = ratings[currentIdx] ?? 0;
  const currentNote = notes[currentIdx] ?? '';
  const trimmedLength = currentNote.trim().length;
  const dogInteractionReady = (() => {
    if (dogInteractionOptIn === null) return false;
    if (dogInteractionOptIn === false) return true;
    const dogOptions = step?.dogOptions ?? [];
    if (dogOptions.length === 0) return true;
    return dogOptions.every(({ dogId }) => {
      const result = dogInteractionResults[dogId];
      if (!result) return false;
      if (result === 'playedNice') return true;
      return dogInteractionRatings[dogId] !== undefined
        && (dogInteractionIssueNotes[dogId] ?? '').trim().length >= MIN_NOTE_LENGTH;
    });
  })();
  const hasReportedDogIssue = Object.values(dogInteractionResults).some((result) => result === 'issue');

  const canSubmit = (() => {
    if (!step) return false;
    if (step.kind === 'dogInteractionPrompt') return dogInteractionReady;
    return currentRating > 0 && trimmedLength >= MIN_NOTE_LENGTH;
  })();
  // Only nudge once the user has started typing but is still under the minimum.
  const noteTooShort = trimmedLength > 0 && trimmedLength < MIN_NOTE_LENGTH;

  const setRating = (rating: number) => {
    setRatings((prev) => {
      const updated = [...prev];
      updated[currentIdx] = rating;
      return updated;
    });
  };

  const setNote = (text: string) => {
    setNotes((prev) => {
      const updated = [...prev];
      updated[currentIdx] = text;
      return updated;
    });
  };

  const goToPrevStep = () => {
    setCurrentIdx((prev) => (prev > 0 ? prev - 1 : prev));
  };

  const advanceStep = () => {
    setCurrentIdx((prev) => Math.min(prev + 1, steps.length - 1));
  };

  const setDogInteractionResult = (dogId: string, result: 'playedNice' | 'issue') => {
    setDogInteractionResults((prev) => ({ ...prev, [dogId]: result }));
    if (result === 'playedNice') {
      setDogInteractionRatings((prev) => {
        const updated = { ...prev };
        delete updated[dogId];
        return updated;
      });
    }
  };

  const setDogInteractionRating = (dogId: string, rating: number) => {
    setDogInteractionRatings((prev) => ({ ...prev, [dogId]: rating }));
  };

  const setDogInteractionIssueNote = (dogId: string, note: string) => {
    setDogInteractionIssueNotes((prev) => ({ ...prev, [dogId]: note }));
  };

  /**
   * Write one review per step, then clear the pending-review flag so the gate
   * releases. Returns true on success, false on any failure (caller surfaces
   * the error). pendingReview is intentionally left intact on failure so the
   * gate re-fires on the next open.
   */
  const submitAllReviews = async (): Promise<boolean> => {
    setSubmitting(true);
    try {
      for (let i = 0; i < steps.length; i++) {
        const s = steps[i];
        if (s.kind === 'dogInteractionPrompt') {
          if (dogInteractionOptIn !== true) continue;
          for (const dog of s.dogOptions ?? []) {
          const result = dogInteractionResults[dog.dogId];
          if (!result) continue;
          const issueNote = (dogInteractionIssueNotes[dog.dogId] ?? '').trim();
          const issueRating = dogInteractionRatings[dog.dogId] ?? 0;
          await submitReview({
            postId: params.postId,
            reviewerId: userProfile?.id ?? '',
            reviewerName: userProfile?.displayName ?? 'Anonymous',
            revieweeId: params.otherUserId,
            targetType: 'dog',
            dogId: dog.dogId,
            dogName: dog.dogName,
            rating: result === 'playedNice' ? 5 : issueRating,
            note: result === 'playedNice'
              ? 'Played nice with other pups.'
              : issueNote,
          });
          }
          continue;
        }
        if (!s.targetType) continue;
        await submitReview({
          postId: params.postId,
          reviewerId: userProfile?.id ?? '',
          reviewerName: userProfile?.displayName ?? 'Anonymous',
          revieweeId: params.otherUserId,
          targetType: s.targetType,
          dogId: s.dogId,
          dogName: s.dogName,
          rating: ratings[i] ?? 0,
          note: (notes[i] ?? '').trim() || undefined,
        });
      }
      if (userProfile?.id) {
        await clearPendingReview(userProfile.id);
      }
      return true;
    } catch (err) {
      console.error('[useReviewFlow] Submit failed:', err);
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  return {
    steps,
    step,
    currentIdx,
    isLast,
    currentRating,
    currentNote,
    canSubmit,
    noteTooShort,
    trimmedLength,
    submitting,
    dogInteractionOptIn,
    dogInteractionResults,
    dogInteractionRatings,
    dogInteractionIssueNotes,
    hasReportedDogIssue,
    setRating,
    setNote,
    setDogInteractionOptIn,
    setDogInteractionResult,
    setDogInteractionRating,
    setDogInteractionIssueNote,
    goToPrevStep,
    advanceStep,
    submitAllReviews,
  };
};
