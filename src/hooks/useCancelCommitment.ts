/**
 * useCancelCommitment — shared 24-hour-aware booking cancellation flow.
 *
 * Single source of truth for cancelling a claimed commitment from BOTH the
 * Requests/Schedule tab (RequestsScreen) and Post Detail (PostDetailScreen).
 * Handles the role-appropriate Alert warning, late-cancel penalty / compensation
 * math, the owner-compensation system message, and late-cancel flagging.
 *
 * Callers pass an optional `onCancelled` callback that runs after a successful
 * cancel so each screen can refresh its list and/or navigate away.
 */
import { useCallback } from 'react';
import { Alert } from 'react-native';
import * as Haptics from 'expo-haptics';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../config/firebase';
import { useAuthContext } from '../contexts/AuthContext';
import { useSwaps } from './useSwaps';
import { usePoints } from './usePoints';
import { usePointsHistory } from './usePointsHistory';
import { sendSystemMessageToUser } from './useMessaging';
import { SwapPost } from '../models/types';

export interface CancelCommitmentOptions {
  /** Invoked after a successful cancel — refresh the list and/or navigate away. */
  onCancelled?: () => void;
}

export function useCancelCommitment() {
  const { user, userProfile } = useAuthContext();
  const { cancelPost } = useSwaps();
  const { deductPoints, addPoints } = usePoints();
  const { recordEntry } = usePointsHistory();

  const cancelCommitment = useCallback(
    (post: SwapPost, options?: CancelCommitmentOptions) => {
      const onCancelled = options?.onCancelled;
      const isOwner = post?.posterId === user?.uid;
      const isSitter = post?.claimedBy === user?.uid;
      const now = new Date();
      const startMs = post.startDate instanceof Date ? post.startDate.getTime() : new Date(post.startDate).getTime();
      const endMs = post.endDate instanceof Date ? post.endDate.getTime() : new Date(post.endDate).getTime();
      const hoursUntilStart = (startMs - now.getTime()) / (1000 * 60 * 60);
      const isLateCancel = hoursUntilStart < 24 && hoursUntilStart > 0;

      const doCancel = async () => {
        try {
          await cancelPost(post.id);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          onCancelled?.();
        } catch (err) {
          console.warn('[useCancelCommitment] Cancel failed:', err);
          Alert.alert('Oops', 'Failed to cancel. Please try again.');
        }
      };

      if (isLateCancel && isSitter) {
        // ── Sitter canceling < 24 hours — strong warning ──
        Alert.alert(
          'Are you sure?',
          'Canceling less than 24 hours before the scheduled care puts the owner in a very difficult position to find a replacement and will likely result in a negative review, which hurts your account overall.\n\nIf we notice a pattern of late cancellations, your account may be at risk for suspension.',
          [
            { text: 'Keep Commitment', style: 'cancel' },
            {
              text: 'Cancel Anyway',
              style: 'destructive',
              onPress: async () => {
                try {
                  await cancelPost(post.id);
                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);

                  // Compensate the owner: 2 points + WatchDog system message
                  const ownerId = post.posterId;
                  const sitterName = user?.displayName ?? 'Your caretaker';

                  await addPoints(ownerId, 2);
                  await recordEntry(ownerId, {
                    type: 'bonus',
                    description: 'Late cancellation compensation from WatchDog',
                    points: 2,
                    relatedPostId: post.id,
                  });

                  const dogName = post.dogName ?? 'your dog';
                  await sendSystemMessageToUser(
                    ownerId,
                    `We see that ${sitterName} canceled their commitment to care for ${dogName} less than 24 hours in advance. We\'re sorry for the inconvenience.\n\nWe\'ve added 2 points to your account to help compensate. We\'ve also noted this on their account \u2014 if this becomes a pattern, their account will be at risk for suspension.\n\nWe hope this helps, and thank you for being part of the WatchDog community! \uD83D\uDC3E`,
                  );

                  onCancelled?.();
                } catch (err) {
                  console.warn('[useCancelCommitment] Sitter late cancel failed:', err);
                  Alert.alert('Oops', 'Failed to cancel. Please try again.');
                }
              },
            },
          ],
        );
      } else if (isLateCancel && isOwner && post.claimedBy) {
        // ── Owner canceling < 24 hours with a sitter assigned — penalty ──
        const totalDays = Math.max(1, Math.round((endMs - startMs) / (1000 * 60 * 60 * 24)));
        const isCashDeal = post.compensationType === 'payment';
        const isEitherDeal = post.compensationType === 'either';

        let penaltyPoints: number;
        let penaltyNote: string;

        if (isCashDeal || (isEitherDeal && !post.pointsOffered)) {
          // Cash deal: 1 point per $20, based on first day's share
          const totalCash = post.paymentAmount ?? 0;
          const firstDayCash = totalDays > 1 ? totalCash / totalDays : totalCash;
          penaltyPoints = Math.max(1, Math.ceil(firstDayCash / 20));
          penaltyNote = totalDays > 1
            ? `Because this is a cash booking, a penalty of ${penaltyPoints} point${penaltyPoints !== 1 ? 's' : ''} will be deducted from your account (based on the first day's rate of $${firstDayCash.toFixed(0)}).`
            : `Because this is a cash booking, a penalty of ${penaltyPoints} point${penaltyPoints !== 1 ? 's' : ''} will be deducted from your account.`;
        } else {
          // Points deal: charge first day's worth of points
          const totalPoints = post.pointsOffered ?? post.pointsCost ?? 0;
          penaltyPoints = totalDays > 1
            ? Math.round((totalPoints / totalDays) * 10) / 10
            : totalPoints;
          penaltyNote = totalDays > 1
            ? `You will still be charged ${penaltyPoints} point${penaltyPoints !== 1 ? 's' : ''} for the first day (total ${totalPoints} points divided by ${totalDays} days).`
            : `You will still be charged ${penaltyPoints} point${penaltyPoints !== 1 ? 's' : ''}.`;
        }

        // Check if user will go negative
        const currentBalance = userProfile?.points ?? 0;
        const willGoNegative = currentBalance < penaltyPoints;
        const negativeNote = willGoNegative
          ? `\n\nNote: Your current balance is ${currentBalance.toFixed(1)} points. After this penalty your account will go into the negatives.`
          : '';

        const sitterId = post.claimedBy;

        Alert.alert(
          'Are you sure you want to cancel?',
          `Canceling less than 24 hours before scheduled care means you will still owe the caretaker.\n\n${penaltyNote}${negativeNote}\n\nThe caretaker will still be able to review this experience, and a late cancellation may result in a negative review.`,
          [
            { text: 'Keep Commitment', style: 'cancel' },
            {
              text: 'Cancel Anyway',
              style: 'destructive',
              onPress: async () => {
                try {
                  // Deduct penalty from owner (allow negative balance)
                  await deductPoints(user!.uid, penaltyPoints, true);
                  await recordEntry(user!.uid, {
                    type: 'deduction',
                    description: `Late cancellation penalty \u2014 ${post.dogName ?? 'dog'} care`,
                    points: -penaltyPoints,
                    relatedPostId: post.id,
                  });

                  // Give the sitter the penalty points
                  await addPoints(sitterId, penaltyPoints);
                  await recordEntry(sitterId, {
                    type: 'bonus',
                    description: `Late cancellation compensation \u2014 ${post.dogName ?? 'dog'} care`,
                    points: penaltyPoints,
                    relatedPostId: post.id,
                  });

                  await cancelPost(post.id);
                  // Mark post as late-cancelled so the sitter gets review prompts
                  updateDoc(doc(db, 'swapPosts', post.id), { lateCancelled: true, lateCancelledBy: 'owner', updatedAt: serverTimestamp() })
                    .catch(() => { /* non-fatal */ });
                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                  onCancelled?.();
                } catch (err) {
                  console.warn('[useCancelCommitment] Late cancel penalty failed:', err);
                  Alert.alert('Oops', 'Failed to cancel. Please try again.');
                }
              },
            },
          ],
        );
      } else {
        // Normal cancel: owner with 24+ hours, sitter with 24+ hours, or no sitter assigned
        Alert.alert(
          'Cancel this commitment?',
          `This will cancel the ${post.dogName} care request. The other person will be notified.`,
          [
            { text: 'Keep it', style: 'cancel' },
            { text: 'Yes, cancel', style: 'destructive', onPress: doCancel },
          ],
        );
      }
    },
    [user, userProfile, cancelPost, deductPoints, addPoints, recordEntry],
  );

  return { cancelCommitment };
}

