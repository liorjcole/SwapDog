import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';
import { spacing, borderRadius, shadow } from '../../config/theme';
import { Review } from '../../models/types';
import StarRating from './StarRating';

interface Props {
  review: Review;
  /** @deprecated Role badges are intentionally hidden; filters explain context instead. */
  showRoleBadge?: boolean;
}

/**
 * Anonymized review row: stars + note + date.
 * NEVER renders reviewerName or reviewerId — reviewers are fully anonymous.
 */
const ReviewCard: React.FC<Props> = ({ review }) => {
  const { colors } = useTheme();
  const note = review?.note ?? review?.comment ?? '';
  const dateLabel =
    review?.createdAt instanceof Date ? review.createdAt.toLocaleDateString() : '';

  return (
    <View
      style={[
        styles.reviewCard,
        {
          backgroundColor: colors.backgroundElevated,
          borderColor: colors.border,
          ...shadow.sm,
        },
      ]}
    >
      <View style={styles.reviewHeader}>
        <StarRating rating={Math.round(review?.rating ?? 0)} size={16} />
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
  reviewCard: {
    padding: spacing.md,
    borderRadius: borderRadius.md,
    marginBottom: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
  },
  reviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  reviewNote: { fontSize: 16, lineHeight: 20, marginBottom: 6 },
  reviewMeta: { fontSize: 14 },
});

export default ReviewCard;
