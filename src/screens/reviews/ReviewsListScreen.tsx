import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTheme } from '../../contexts/ThemeContext';
import { useReviews } from '../../hooks/useReviews';
import { useDogs } from '../../hooks/useDogs';
import { Dog, Review } from '../../models/types';
import { spacing } from '../../config/theme';
import StarRating from '../../components/common/StarRating';
import ReviewCard from '../../components/common/ReviewCard';
import LoadingSpinner from '../../components/common/LoadingSpinner';

type ReviewsListParams = {
  userId: string;
  displayName: string;
  dogId?: string;
  dogName?: string;
};

type Props = {
  navigation: NativeStackNavigationProp<any>;
  route: RouteProp<{ ReviewsList: ReviewsListParams }, 'ReviewsList'>;
};

type RoleFilter = 'all' | 'owner' | 'caregiver';

/** Average of a review set's ratings (0 when empty). */
const averageRating = (reviews: Review[]): number => {
  if (!reviews || reviews.length === 0) return 0;
  const sum = reviews.reduce((acc, r) => acc + (r?.rating ?? 0), 0);
  return sum / reviews.length;
};

/**
 * Layered, fully-anonymized reviews breakdown.
 * User mode (no dogId): person reviews (refinable by role) then one section per dog with reviews.
 * Dog mode (dogId set): only that dog's reviews.
 */
const ReviewsListScreen: React.FC<Props> = ({ route }) => {
  const { colors } = useTheme();
  const { getReviewsForUser } = useReviews();
  const { getDogsByOwner } = useDogs();

  const userId = route.params?.userId;
  const displayName = route.params?.displayName ?? 'this user';
  const dogId = route.params?.dogId;
  const isDogMode = !!dogId;

  const [reviews, setReviews] = useState<Review[]>([]);
  const [dogs, setDogs] = useState<Dog[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');

  useEffect(() => {
    let active = true;
    setLoadError(null);
    setLoading(true);
    const load = async () => {
      if (!userId) {
        if (active) setLoading(false);
        return;
      }
      try {
        const fetched = await getReviewsForUser(userId);
        if (active) setReviews(fetched ?? []);
      } catch (err) {
        // Append the real error so a missing Firestore index (FAILED_PRECONDITION)
        // or a permission error is visible on-device instead of the generic message.
        console.error('[ReviewsList] Load failed:', err);
        if (active)
          setLoadError(
            `Could not load reviews.\n${(err as { message?: string })?.message ?? String(err)}`,
          );
      }
      // Fetch dogs in its own try/catch so a dogs-collection failure can't
      // masquerade as a reviews-load error; reviews stay visible even if this fails.
      if (!isDogMode) {
        try {
          const ownerDogs = await getDogsByOwner(userId);
          if (active) setDogs(ownerDogs ?? []);
        } catch (err) {
          console.error('[ReviewsList] getDogsByOwner failed:', err);
          // Non-fatal: per-dog sections are hidden but reviews remain visible.
        }
      }
      if (active) setLoading(false);
    };
    load();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, isDogMode, retryKey]);

  // ── Dog mode: only this dog's reviews ──
  const dogModeReviews = useMemo(
    () => reviews.filter((r) => r?.targetType === 'dog' && r?.dogId === dogId),
    [reviews, dogId],
  );

  // ── User mode: person reviews + per-dog grouping ──
  const personReviews = useMemo(
    () => reviews.filter((r) => r?.targetType !== 'dog'),
    [reviews],
  );
  const filteredPersonReviews = useMemo(() => {
    if (roleFilter === 'all') return personReviews;
    return personReviews.filter((r) => r?.targetType === roleFilter);
  }, [personReviews, roleFilter]);
  const dogsWithReviews = useMemo(
    () =>
      dogs
        .map((dog) => ({
          dog,
          dogReviews: reviews.filter((r) => r?.targetType === 'dog' && r?.dogId === dog.id),
        }))
        .filter(({ dogReviews }) => dogReviews.length > 0),
    [dogs, reviews],
  );

  const ownerCount = useMemo(
    () => personReviews.filter((r) => r?.targetType === 'owner').length,
    [personReviews],
  );
  const caregiverCount = useMemo(
    () => personReviews.filter((r) => r?.targetType === 'caregiver').length,
    [personReviews],
  );

  const handleRetry = () => {
    setReviews([]);
    setDogs([]);
    setRetryKey((k) => k + 1);
  };

  if (loading) return <LoadingSpinner />;

  if (loadError) {
    return (
      <View style={[styles.errorContainer, { backgroundColor: colors.background }]}>
        <Text style={[styles.errorText, { color: colors.textSecondary }]}>{loadError}</Text>
        <TouchableOpacity
          onPress={handleRetry}
          style={[styles.retryButton, { borderColor: colors.primary }]}
          accessibilityRole="button"
          accessibilityLabel="Retry loading reviews"
        >
          <Text style={[styles.retryText, { color: colors.primary }]}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const renderChip = (key: RoleFilter, label: string) => (
    <TouchableOpacity
      key={key}
      onPress={() => setRoleFilter(key)}
      style={[
        styles.filterChip,
        {
          borderColor: roleFilter === key ? colors.primary : colors.border,
          backgroundColor: roleFilter === key ? colors.primary + '15' : 'transparent',
        },
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Text
        style={[
          styles.filterText,
          { color: roleFilter === key ? colors.primary : colors.textSecondary },
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );

  // ── Dog mode render ──
  if (isDogMode) {
    return (
      <ScrollView style={[styles.container, { backgroundColor: colors.background }]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>
          {route.params?.dogName ? `${route.params.dogName} Reviews` : 'Dog Reviews'}
        </Text>
        {dogModeReviews.length === 0 ? (
          <Text style={[styles.empty, { color: colors.textSecondary }]}>No reviews yet</Text>
        ) : (
          dogModeReviews.map((rev) => <ReviewCard key={rev.id} review={rev} />)
        )}
      </ScrollView>
    );
  }

  // ── User mode render ──
  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Section 1 — person reviews */}
      <Text style={[styles.sectionTitle, { color: colors.text }]}>
        Reviews for {displayName}
      </Text>
      {personReviews.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow}>
          {renderChip('all', `All (${personReviews.length})`)}
          {ownerCount > 0 && renderChip('owner', `As Owner (${ownerCount})`)}
          {caregiverCount > 0 && renderChip('caregiver', `As Caregiver (${caregiverCount})`)}
        </ScrollView>
      )}
      {filteredPersonReviews.length === 0 ? (
        <Text style={[styles.empty, { color: colors.textSecondary }]}>No reviews yet</Text>
      ) : (
        filteredPersonReviews.map((rev) => (
          <ReviewCard key={rev.id} review={rev} showRoleBadge />
        ))
      )}

      {/* Sections 2…N — one block per dog with reviews */}
      {dogsWithReviews.map(({ dog, dogReviews }) => {
        const avg = dog.rating ?? averageRating(dogReviews);
        return (
          <View key={dog.id} style={styles.dogSection}>
            <View style={styles.dogHeader}>
              <Text style={[styles.dogName, { color: colors.text }]}>{dog.name}</Text>
              <View style={styles.dogHeaderRight}>
                <StarRating rating={Math.round(avg)} size={16} />
                <Text style={[styles.dogCount, { color: colors.textSecondary }]}>
                  {dogReviews.length} review{dogReviews.length !== 1 ? 's' : ''}
                </Text>
              </View>
            </View>
            {dogReviews.map((rev) => (
              <ReviewCard key={rev.id} review={rev} />
            ))}
          </View>
        );
      })}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, padding: spacing.md },
  sectionTitle: { fontSize: 20, fontWeight: '700', marginBottom: spacing.sm },
  filterRow: { marginBottom: spacing.md },
  filterChip: {
    borderWidth: 1.5,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 6,
    marginRight: 8,
  },
  filterText: { fontSize: 15, fontWeight: '600' },
  empty: { fontSize: 16, marginBottom: spacing.md },
  dogSection: { marginTop: spacing.lg },
  dogHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  dogName: { fontSize: 18, fontWeight: '700' },
  dogHeaderRight: { flexDirection: 'row', alignItems: 'center' },
  dogCount: { fontSize: 14, marginLeft: spacing.xs },
  errorContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  errorText: { fontSize: 16, textAlign: 'center', marginBottom: spacing.md },
  retryButton: { borderWidth: 1.5, borderRadius: 20, paddingHorizontal: 24, paddingVertical: 10 },
  retryText: { fontSize: 16, fontWeight: '700' },
});

export default ReviewsListScreen;

