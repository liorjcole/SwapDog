import { useMemo, useState } from 'react';
import { useAuthContext } from '../contexts/AuthContext';
import { useReviews } from './useReviews';
import { ReviewTargetType } from '../models/types';

// Minimum characters required in the note on EVERY review step.
export const MIN_NOTE_LENGTH = 10;

// ─── Params shared by the voluntary ReviewScreen and the mandatory gate ──────
export interface ReviewFlowParams {
  postId: string;
  /** 'owner' = you posted it, review the caregiver only
   *  'caregiver' = you sat, review each dog then the owner */
  role: 'owner' | 'caregiver';
  otherUserId: string;
  otherUserName: string;
  dogIds: string[];
  dogNames: string[];
  /** Primary photo URL for each dog — index-aligned with dogIds. Undefined renders no avatar. */
  dogPhotoURLs?: string[];
  /** Profile photo URL of the other user being reviewed (owner in caregiver flow). */
  otherUserPhotoURL?: string;
}

export interface ReviewStep {
  targetType: ReviewTargetType;
  dogId?: string;
  dogName?: string;
  /** Identity photo shown under the step title. Undefined = no avatar rendered. */
  photoURL?: string;
  title: string;
  subtitle: string;
  hint: string;
}

/**
 * Single source of truth for the post-commitment review flow: the ordered step
 * machine, per-step star/note state, validation (stars > 0 AND note >= 10
 * chars), and the Firestore writes (submitReview per step + clearPendingReview).
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
    if (params.role === 'owner') {
      // Owner reviews the caregiver — single step.
      return [
        {
          targetType: 'caregiver' as ReviewTargetType,
          title: `Rate ${params.otherUserName} as a caregiver`,
          subtitle: 'How was their care of your pup?',
          hint: 'Rate their reliability, attentiveness, and how well they cared for your dog.',
        },
      ];
    }

    // Caregiver reviews each dog first, then the owner. Empty dogIds falls back
    // to just the owner step so the user is never trapped on a zero-step flow.
    const dogIds = params.dogIds ?? [];
    const dogNames = params.dogNames ?? [];
    const dogPhotoURLs = params.dogPhotoURLs ?? [];
    const dogSteps: ReviewStep[] = dogIds.map((dogId, i) => ({
      targetType: 'dog' as ReviewTargetType,
      dogId,
      dogName: dogNames[i] ?? 'the dog',
      photoURL: dogPhotoURLs[i],
      title: `Rate ${dogNames[i] ?? 'the dog'} 🐾`,
      subtitle: '⚠️ This rating is about the dog — not the owner.',
      hint: 'Was the dog friendly, well-behaved, and as described? Any issues with temperament, energy, or special needs?',
    }));

    const ownerStep: ReviewStep = {
      targetType: 'owner' as ReviewTargetType,
      photoURL: params.otherUserPhotoURL,
      title: `Rate ${params.otherUserName} as an owner`,
      subtitle: '⚠️ This rating is about the owner — not the dog.',
      hint: 'How were their response times? Were they clear and transparent about what was needed? How reputable and reliable were they?',
    };

    return [...dogSteps, ownerStep];
  }, [params]);

  // ── Per-step state ───────────────────────────────────────────────────────
  const [currentIdx, setCurrentIdx] = useState(0);
  const [ratings, setRatings] = useState<number[]>(() => steps.map(() => 0));
  const [notes, setNotes] = useState<string[]>(() => steps.map(() => ''));
  const [submitting, setSubmitting] = useState(false);

  const step = steps[currentIdx];
  const isLast = currentIdx === steps.length - 1;
  const currentRating = ratings[currentIdx] ?? 0;
  const currentNote = notes[currentIdx] ?? '';
  const trimmedLength = currentNote.trim().length;

  // Stars required AND a note of at least MIN_NOTE_LENGTH characters — enforced
  // on every step, including each per-dog caregiver step.
  const canSubmit = currentRating > 0 && trimmedLength >= MIN_NOTE_LENGTH;
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
    setRating,
    setNote,
    goToPrevStep,
    advanceStep,
    submitAllReviews,
  };
};

