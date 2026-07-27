import { useCallback } from 'react';
import { Alert } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useAuthContext } from '../contexts/AuthContext';
import { SwapPost } from '../models/types';
import { cancelCommitmentSecure } from '../services/secureOperations';

export interface CancelCommitmentOptions {
  onCancelled?: () => void;
}

function ownerPenaltyPreview(post: SwapPost): number {
  const startMs = post.startDate.getTime();
  const endMs = post.endDate.getTime();
  const totalDays = Math.max(
    1,
    Math.round((endMs - startMs) / (24 * 60 * 60 * 1000)),
  );
  const cashOnly =
    post.compensationType === 'payment'
    || (post.compensationType === 'either' && !post.pointsOffered);
  if (cashOnly) {
    const payment = post.paymentAmount ?? 0;
    const firstDay = totalDays > 1 ? payment / totalDays : payment;
    return Math.max(1, Math.ceil(firstDay / 20));
  }
  const points = post.pointsOffered ?? post.pointsCost ?? 0;
  return totalDays > 1
    ? Math.round((points / totalDays) * 10) / 10
    : points;
}

export function useCancelCommitment() {
  const { user, userProfile } = useAuthContext();

  const cancelCommitment = useCallback(
    (post: SwapPost, options?: CancelCommitmentOptions) => {
      const isOwner = post.posterId === user?.uid;
      const isSitter = post.claimedBy === user?.uid;
      const startMs = post.startDate.getTime();
      const hoursUntilStart = (startMs - Date.now()) / (60 * 60 * 1000);
      const isLateCancel =
        post.status === 'claimed'
        && hoursUntilStart > 0
        && hoursUntilStart < 24;

      const completeCancellation = async () => {
        try {
          await cancelCommitmentSecure(post.id);
          await Haptics.notificationAsync(
            Haptics.NotificationFeedbackType.Warning,
          );
          options?.onCancelled?.();
        } catch (error) {
          console.warn('[useCancelCommitment] Cancel failed:', error);
          Alert.alert('Could Not Cancel', 'Please try again.');
        }
      };

      if (isLateCancel && isSitter) {
        Alert.alert(
          'Are you sure?',
          'Canceling less than 24 hours before care makes it difficult for the owner '
          + 'to find a replacement. The cancellation will be recorded, and repeated '
          + 'late cancellations may put your account at risk.',
          [
            { text: 'Keep Commitment', style: 'cancel' },
            {
              text: 'Cancel Anyway',
              style: 'destructive',
              onPress: completeCancellation,
            },
          ],
        );
        return;
      }

      if (isLateCancel && isOwner && post.claimedBy) {
        const penalty = ownerPenaltyPreview(post);
        const balance = userProfile?.points ?? 0;
        const balanceNote = balance < penalty
          ? ` Your current ${balance.toFixed(1)} point balance will become negative.`
          : '';
        Alert.alert(
          'Are you sure you want to cancel?',
          `Because care begins in less than 24 hours, ${penalty} point`
          + `${penalty === 1 ? '' : 's'} will be transferred to the caretaker.`
          + `${balanceNote} The caretaker may still review this experience.`,
          [
            { text: 'Keep Commitment', style: 'cancel' },
            {
              text: 'Cancel Anyway',
              style: 'destructive',
              onPress: completeCancellation,
            },
          ],
        );
        return;
      }

      Alert.alert(
        'Cancel this commitment?',
        `This will cancel the ${post.dogName} care request.`,
        [
          { text: 'Keep it', style: 'cancel' },
          {
            text: 'Yes, cancel',
            style: 'destructive',
            onPress: completeCancellation,
          },
        ],
      );
    },
    [user?.uid, userProfile?.points],
  );

  return { cancelCommitment };
}
