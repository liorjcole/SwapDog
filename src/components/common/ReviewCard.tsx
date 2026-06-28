import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';
import { spacing, borderRadius } from '../../config/theme';
import { Review } from '../../models/types';
import StarRating from './StarRating';

interface Props {
  review: Review;
  /** When true, render an "As Owner"/"As Caregiver" badge derived from targetType. */
  showRoleBadge?: boolean;
}

/** Map a person review's targetType to its role label. Dog reviews have no role badge. */
const roleLabel = (targetType: Review['targetType']): string | null => {
  if (targetType === 'owner') return 'As Owner';
  if (targetType === 'caregiver') return 'As Caregiver';
  return null;
};

/**
 * Anonymized review row: stars + optional role badge + note + date.
 * NEVER renders reviewerName or reviewerId — reviewers are fully anonymous.
 */
const ReviewCard: React.FC<Props> = ({ review, showRoleBadge }) => {
  const { colors } = useTheme();
  const note = review?.note ?? review?.comment ?? '';
  const badge = showRoleBadge ? roleLabel(review?.targetType) : null;
  const dateLabel =
    review?.createdAt instanceof Date ? review.createdAt.toLocaleDateString() : '';

  return (
    <View style={[styles.reviewCard, { backgroundColor: colors.backgroundElevated }]}>
      <View style={styles.reviewHeader}>
        <StarRating rating={Math.round(review?.rating ?? 0)} size={16} />
        {badge ? (
          <Text style={[styles.reviewBadge, { color: colors.primary }]}>{badge}</Text>
        ) : null}
      </View>
      {note ? (
        <Text style={[styles.reviewNote, { color: colors.text }]}>{note}</Text>
      ) : null}
      {dateLabel ? (
        <Text style={[styles.reviewMeta, { color: colors.textSecondary }]}>{dateLabel}</Text>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  reviewCard: { padding: spacing.md, borderRadius: borderRadius.md, marginBottom: spacing.sm },
  reviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  reviewBadge: { fontSize: 14, fontWeight: '700' },
  reviewNote: { fontSize: 16, lineHeight: 20, marginBottom: 6 },
  reviewMeta: { fontSize: 14 },
});

export default ReviewCard;

