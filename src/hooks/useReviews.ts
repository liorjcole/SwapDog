import {
  collection,
  getDocs,
  query,
  where,
  orderBy,
} from 'firebase/firestore';
import { db } from '../config/firebase';
import { Review, ReviewTargetType } from '../models/types';
import { toDate } from '../utils/firestoreConverters';
import {
  clearPendingReviewSecure,
  submitReviewSecure,
} from '../services/secureOperations';

// ─── Firestore → Review parser ───────────────────────────────────────────────
const parseReview = (id: string, data: Record<string, unknown>): Review => ({
  id,
  postId: (data.postId as string) ?? (data.swapRequestId as string) ?? '',
  reviewerId: data.reviewerId as string,
  reviewerName: (data.reviewerName as string) ?? 'Anonymous',
  revieweeId: data.revieweeId as string,
  targetType: (data.targetType as ReviewTargetType) ?? 'owner',
  dogId: data.dogId as string | undefined,
  dogName: data.dogName as string | undefined,
  rating: data.rating as number,
  note: (data.note as string) ?? (data.comment as string) ?? undefined,
  createdAt: toDate(data.createdAt as Parameters<typeof toDate>[0]),
  // Legacy compat
  swapRequestId: data.swapRequestId as string | undefined,
  comment: data.comment as string | undefined,
  reviewRole: data.reviewRole as 'owner' | 'sitter' | undefined,
});

export const useReviews = () => {
  /**
   * Submit one review (called once per target: each dog + owner, or caregiver).
   */
  const submitReview = async (data: {
    postId: string;
    reviewerId: string;
    reviewerName: string;
    revieweeId: string;
    targetType: ReviewTargetType;
    dogId?: string;
    dogName?: string;
    rating: number;
    note?: string;
  }): Promise<string> => {
    const { reviewerId: _reviewerId, reviewerName: _reviewerName, ...input } = data;
    const result = await submitReviewSecure(input);
    return result.reviewId;
  };

  /**
   * Get all reviews for a user (as reviewee), newest first.
   */
  const getReviewsForUser = async (userId: string): Promise<Review[]> => {
    const reviewsRef = collection(db, 'reviews');
    try {
      const orderedQuery = query(
        reviewsRef,
        where('revieweeId', '==', userId),
        orderBy('createdAt', 'desc'),
      );
      const snap = await getDocs(orderedQuery);
      return snap.docs.map((d) => parseReview(d.id, d.data() as Record<string, unknown>));
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code !== 'failed-precondition') throw err;

      const fallbackQuery = query(reviewsRef, where('revieweeId', '==', userId));
      const snap = await getDocs(fallbackQuery);
      return snap.docs
        .map((d) => parseReview(d.id, d.data() as Record<string, unknown>))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    }
  };

  /**
   * Check if a review already exists for a specific post + reviewer + target combo.
   */
  const hasReviewed = async (
    postId: string,
    reviewerId: string,
    targetType: ReviewTargetType,
    dogId?: string,
  ): Promise<boolean> => {
    const constraints = [
      where('postId', '==', postId),
      where('reviewerId', '==', reviewerId),
      where('targetType', '==', targetType),
    ];
    if (dogId) constraints.push(where('dogId', '==', dogId));
    const q = query(collection(db, 'reviews'), ...constraints);
    const snap = await getDocs(q);
    return !snap.empty;
  };

  /**
   * Clear the pending review flag from a user doc.
   */
  const clearPendingReview = async (_userId: string): Promise<void> => {
    await clearPendingReviewSecure();
  };

  // Legacy compat wrapper
  const createReview = submitReview as unknown as (
    data: Omit<Review, 'id' | 'createdAt'>
  ) => Promise<string>;

  return { submitReview, getReviewsForUser, hasReviewed, clearPendingReview, createReview };
};
