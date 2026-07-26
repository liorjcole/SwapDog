import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, useWindowDimensions } from 'react-native';
import { RouteProp } from '@react-navigation/native';
import { DiscoverStackParamList } from '../../navigation/types';
import { useTheme } from '../../contexts/ThemeContext';
import { useDogs } from '../../hooks/useDogs';
import { useReviews } from '../../hooks/useReviews';
import { Dog, Review } from '../../models/types';
import { spacing, borderRadius, shadow, typography } from '../../config/theme';
import PhotoCarousel from '../../components/common/PhotoCarousel';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import StarRating from '../../components/common/StarRating';
import ReviewCard from '../../components/common/ReviewCard';
import { formatDogAge } from '../../utils/formatDogAge';

type Props = {
  route: RouteProp<DiscoverStackParamList, 'DogDetail'>;
};

const DogDetailScreen: React.FC<Props> = ({ route }) => {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const { dogId } = route.params ?? {};
  const { getDog } = useDogs();
  const { getReviewsForUser } = useReviews();
  const [dog, setDog] = useState<Dog | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      try {
        const d = await getDog(dogId);
        if (!active) return;
        setDog(d);

        if (d?.ownerId) {
          const fetchedReviews = await getReviewsForUser(d.ownerId);
          if (!active) return;
          setReviews(fetchedReviews.filter((r) => r.targetType === 'dog' && r.dogId === d.id));
        } else {
          setReviews([]);
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dogId]);

  if (loading) return <LoadingSpinner />;
  if (!dog) return null;

  const infoBubbles = [
    formatDogAge(dog.ageYears, dog.ageMonths),
    dog.sex,
    `${dog.energyLevel.replace('_', ' ')} energy`,
    dog.weightLbs > 0 ? `${dog.weightLbs} lbs` : null,
  ].filter((value): value is string => Boolean(value));

  const traitBubbles = [
    dog.isGoodWithDogs ? 'Good with dogs' : null,
    dog.isGoodWithKids ? 'Good with kids' : null,
    dog.isSpayedNeutered ? 'Spayed/Neutered' : null,
    dog.vaccinated ? 'Vaccinated' : null,
    dog.pottyTrained ? 'Potty trained' : null,
  ].filter((value): value is string => Boolean(value));

  const averageRating = dog.rating
    ?? (reviews.length > 0 ? reviews.reduce((sum, review) => sum + (review.rating ?? 0), 0) / reviews.length : 0);
  const reviewCount = dog.reviewCount ?? reviews.length;

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]}>
      <PhotoCarousel photos={dog.photoURLs} height={width} />
      <View style={styles.content}>
        <Text style={[styles.name, { color: colors.text }]} accessibilityRole="header">{dog.name}</Text>
        <Text style={[styles.breed, { color: colors.textSecondary }]}>{dog.breed}</Text>

        <View style={styles.bubbleRow}>
          {infoBubbles.map((label) => (
            <View key={label} style={[styles.infoBubble, { backgroundColor: colors.backgroundElevated, borderColor: colors.border }]}>
              <Text style={[styles.infoBubbleText, { color: colors.text }]}>{label}</Text>
            </View>
          ))}
        </View>

        {traitBubbles.length > 0 && (
          <View style={styles.bubbleRow}>
            {traitBubbles.map((label) => (
              <View key={label} style={[styles.traitBubble, { backgroundColor: colors.primary + '18', borderColor: colors.primary }]}>
                <Text style={[styles.traitBubbleText, { color: colors.primary }]}>{label}</Text>
              </View>
            ))}
          </View>
        )}

        {dog.bio && <Text style={[styles.bio, { color: colors.text }]}>{dog.bio}</Text>}
        {dog.temperament ? <Text style={[styles.bio, { color: colors.text }]}>{dog.temperament}</Text> : null}

        <View style={[styles.reviewsSection, { backgroundColor: colors.surface, borderColor: colors.border, ...shadow.sm }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Reviews</Text>
          {reviewCount > 0 ? (
            <View style={styles.ratingHeader}>
              <StarRating rating={Math.round(averageRating)} size={20} />
              <Text style={[styles.ratingText, { color: colors.textSecondary }]}>
                {reviewCount} review{reviewCount !== 1 ? 's' : ''}
              </Text>
            </View>
          ) : (
            <Text style={[styles.emptyReviews, { color: colors.textSecondary }]}>No reviews yet</Text>
          )}

          {reviews.map((review) => (
            <ReviewCard key={review.id} review={review} />
          ))}
        </View>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: spacing.lg },
  name: { ...typography.h2, marginBottom: spacing.xs },
  breed: { fontSize: 18, marginBottom: spacing.md },
  bubbleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  infoBubble: { borderWidth: StyleSheet.hairlineWidth, borderRadius: borderRadius.full, paddingHorizontal: 14, paddingVertical: 8 },
  infoBubbleText: { fontSize: 15, fontWeight: '700', textTransform: 'capitalize' },
  traitBubble: { borderWidth: 1, borderRadius: borderRadius.full, paddingHorizontal: 14, paddingVertical: 8 },
  traitBubbleText: { fontSize: 15, fontWeight: '700' },
  ratingHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  ratingText: { fontSize: 14, marginLeft: spacing.xs, textDecorationLine: 'underline' },
  bio: { ...typography.body, marginBottom: spacing.lg, lineHeight: 22 },
  sectionTitle: { ...typography.h3, marginBottom: spacing.sm },
  reviewsSection: { borderWidth: StyleSheet.hairlineWidth, borderRadius: borderRadius.lg, padding: spacing.md, marginTop: spacing.sm },
  emptyReviews: { fontSize: 16 },
});

export default DogDetailScreen;
