import React, { memo, useCallback } from 'react';
import { View, Text, TouchableOpacity, Image, Animated, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../../contexts/ThemeContext';
import { smartDate, isSameDay } from '../../utils/dateHelpers';
import { spacing, borderRadius, shadow } from '../../config/theme';
import { SwapPost } from '../../models/types';
import EventProgressBar from './EventProgressBar';

const RED = '#FF2D55';

const getCareTypeLabel = (t: string): string => {
  switch (t) {
    case 'overnight': return 'Overnight sitting';
    case 'daySitting': return 'Daytime sitting';
    case 'feeding': return 'Feeding';
    case 'dogWalking': return 'Walk';
    case 'medication': return 'Medication';
    default: return t;
  }
};

function getSummaryDate(post: SwapPost): string {
  const start = smartDate(post.startDate);
  const end = smartDate(post.endDate);

  if (post.careType === 'overnight') {
    const range = isSameDay(post.startDate, post.endDate) ? start : `${start} – ${end}`;
    return range;
  }

  const timeRange = post.startTime && post.endTime
    ? `, ${post.startTime} – ${post.endTime}`
    : post.startTime
      ? `, ${post.startTime}`
      : '';

  return `${start}${timeRange}`;
}

function getDetailsSummary(post: SwapPost): string {
  const details: string[] = [];

  if (post.feedingSlots?.length) details.push('Feeding');
  if (post.walkSessions?.length) details.push('Walks');
  if (post.playSessions?.length) details.push('Playtime');
  if (post.medicationSlots?.length) details.push('Medication');

  if (details.length === 0 && post.careType) {
    details.push(getCareTypeLabel(post.careType));
  }

  return details.join(', ');
}

export interface PostCardProps {
  post: SwapPost;
  onPress: (postId: string) => void;
  currentUserId?: string;
  isFavorited?: boolean;
  isHighlighted?: boolean;
  pulseScale?: Animated.Value;
  glowOpacity?: Animated.Value;
  /** When true, hides the "See Full Details" button — used in reuse-modal context; Discover remains unaffected. */
  hideSeeFullDetails?: boolean;
  /** When true, the post has been claimed by another sitter — dims the card and shows a gray lock badge. */
  isClaimed?: boolean;
}

const PostCard: React.FC<PostCardProps> = memo(({ post, onPress, currentUserId, isFavorited, isHighlighted, pulseScale, glowOpacity, hideSeeFullDetails, isClaimed }) => {
  const handlePostPress = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress(post.id);
  }, [onPress, post.id]);
  const { colors } = useTheme();
  const isOwnPost = !!(currentUserId && post.posterId === currentUserId);
  const dateSummary = getSummaryDate(post);
  const detailsSummary = getDetailsSummary(post);

  return (
    // Dim the entire card when claimed — mirrors the past-commitments dim in RequestsScreen (~L769)
    <Animated.View style={[isHighlighted && pulseScale && glowOpacity ? { transform: [{ scale: pulseScale }], shadowColor: '#FFFFFF', shadowOpacity: glowOpacity as unknown as number, shadowRadius: 20, shadowOffset: { width: 0, height: 0 }, elevation: 10 } : undefined, isClaimed ? { opacity: 0.55 } : undefined]}>
    <TouchableOpacity
      style={[styles.postCard, { backgroundColor: (isOwnPost && !isClaimed) ? '#1A0A10' : colors.surface, ...shadow.sm, ...(isClaimed ? { borderWidth: 1, borderColor: colors.border } : { ...(isFavorited && !isOwnPost ? { borderWidth: 2, borderColor: '#FFD700' } : {}), ...(isOwnPost ? { borderWidth: 1.5, borderColor: RED + '80' } : {}) }) }]}
      onPress={handlePostPress}
      accessibilityRole="button"
      accessibilityLabel={`Post for ${post.dogName}`}
    >
      <View style={styles.postCardInner}>
        {post.careType === 'overnight' && (
          <View style={styles.overnightBadge}>
            <Text style={styles.overnightBadgeText}>🌙 Overnight</Text>
          </View>
        )}
        {/* Own post badge — top right; suppressed when Claimed wins priority */}
        {isOwnPost && !isClaimed && (
          <View style={{ position: 'absolute', top: -1, right: -1, backgroundColor: RED, paddingHorizontal: 10, paddingVertical: 4, borderBottomLeftRadius: 8, borderTopRightRadius: 10, zIndex: 10 }}>
            <Text style={{ fontSize: 12, fontWeight: '800', color: '#FFFFFF', letterSpacing: 0.5 }}>YOUR POST</Text>
          </View>
        )}
        {/* Favorited badge — top right; suppressed when Claimed wins priority */}
        {isFavorited && !isOwnPost && !isClaimed && (
          <View style={{ position: 'absolute', top: -1, right: -1, backgroundColor: '#FFD700', paddingHorizontal: 10, paddingVertical: 4, borderBottomLeftRadius: 8, borderTopRightRadius: 10, zIndex: 10 }}>
            <Text style={{ fontSize: 12, fontWeight: '800', color: '#000000', letterSpacing: 0.5 }}>FAVORITE</Text>
          </View>
        )}
        {/* Claimed badge — gray, top right; wins over YOUR POST and FAVORITE */}
        {isClaimed && (
          <View style={{ position: 'absolute', top: -1, right: -1, backgroundColor: '#78909C', paddingHorizontal: 10, paddingVertical: 4, borderBottomLeftRadius: 8, borderTopRightRadius: 10, zIndex: 10 }}>
            <Text style={{ fontSize: 12, fontWeight: '800', color: '#FFFFFF', letterSpacing: 0.5 }}>🔒 Claimed</Text>
          </View>
        )}
        {/* Dog photos + names row */}
        <View style={[styles.cardHeader, post.careType === 'overnight' && styles.cardHeaderWithTopBadge]}>
          {/* Dog avatar(s) */}
          {post.dogPhotoURLs && post.dogPhotoURLs.length > 1 ? (
            <View style={{ flexDirection: 'row', marginRight: 10 }}>
              {post.dogPhotoURLs.map((url, i) => (
                url ? (
                  <Image key={i} source={{ uri: url }} style={[styles.dogThumbLead, { borderColor: colors.border, marginRight: i < post.dogPhotoURLs!.length - 1 ? -8 : 0, zIndex: post.dogPhotoURLs!.length - i }]} />
                ) : (
                  <View key={i} style={[styles.dogThumbLeadPlaceholder, { backgroundColor: RED + '12', marginRight: i < post.dogPhotoURLs!.length - 1 ? -8 : 0, zIndex: post.dogPhotoURLs!.length - i }]}>
                    <Text style={{ fontSize: 24 }}>🐶</Text>
                  </View>
                )
              ))}
            </View>
          ) : post.dogPhotoURL ? (
            <Image source={{ uri: post.dogPhotoURL }} style={[styles.dogThumbLead, { borderColor: colors.border }]} />
          ) : (
            <View style={[styles.dogThumbLeadPlaceholder, { backgroundColor: RED + '12' }]}>
              <Text style={{ fontSize: 24 }}>🐶</Text>
            </View>
          )}
          <View style={styles.headerInfo}>
            <Text style={[styles.dogLine, { color: colors.text, marginBottom: 0 }]} numberOfLines={1}>
              {isFavorited && !isClaimed && <Text style={{ color: '#FFD700' }}>★ </Text>}
              {post.dogNames && post.dogNames.length > 1
                ? post.dogNames.join(' & ')
                : post.dogName}
            </Text>
            <Text style={[styles.dateRange, { color: colors.textSecondary }]}>{dateSummary}</Text>
          </View>
          {post.compensationType && (
            <Text style={{ fontSize: 15, fontWeight: '700', color: colors.text }} numberOfLines={1}>
              💰 {post.compensationType === 'points'
                ? `${post.pointsOffered ?? post.pointsCost ?? 0} points`
                : post.compensationType === 'payment'
                  ? `$${post.totalPayment ?? post.paymentAmount ?? 0}${post.paymentRate ? (post.paymentRate === 'per_hour' ? '/hr' : '/day') : ''}`
                  : post.compensationType === 'either'
                    ? `${post.pointsOffered ?? post.pointsCost ?? 0} pts or $${post.totalPayment ?? post.paymentAmount ?? 0}`
                    : 'TBD'}
            </Text>
          )}
        </View>

        {detailsSummary ? (
          <View style={{ marginTop: 8, borderTopWidth: 0.5, borderTopColor: colors.border, paddingTop: 8 }}>
            <Text style={{ fontSize: 15, color: colors.textSecondary }} numberOfLines={1}>
              <Text style={{ color: colors.text, fontWeight: '700' }}>Details: </Text>
              {detailsSummary}
            </Text>
          </View>
        ) : null}

        {post.status === 'open' && currentUserId && (post.respondedBy ?? []).some(r => r.userId === currentUserId) && (
          <View style={styles.respondedBadge}>
            <Text style={styles.respondedBadgeText}>Messaged ✓</Text>
          </View>
        )}

        {!hideSeeFullDetails && (
          <View style={[styles.detailsBtn, isFavorited && !isOwnPost && !isClaimed && { borderColor: '#FFD700' }]}>
            <Text style={[styles.detailsBtnText, isFavorited && !isOwnPost && !isClaimed && { color: '#FFD700' }]}>See Full Details</Text>
          </View>
        )}

        {/* ── In-Progress Time Bar ── */}
        <EventProgressBar
          post={post}
          style={{ marginHorizontal: -spacing.md, marginBottom: -spacing.md }}
        />
      </View>
    </TouchableOpacity>
    </Animated.View>
  );
});

PostCard.displayName = 'PostCard';

const styles = StyleSheet.create({
  postCard: { flexDirection: 'row', borderRadius: borderRadius.lg, marginBottom: spacing.sm, overflow: 'hidden' },
  postCardInner: { flex: 1, padding: spacing.md },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  headerInfo: { flex: 1 },
  dateRange: { fontSize: 16, fontWeight: '600', marginTop: 1 },
  dogThumbLead: { width: 48, height: 48, borderRadius: 24, borderWidth: 1.5 },
  dogThumbLeadPlaceholder: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  dogLine: { fontSize: 16, fontWeight: '600', marginBottom: spacing.xs },
  cardHeaderWithTopBadge: { marginTop: 16 },
  overnightBadge: {
    position: 'absolute',
    top: -1,
    left: -1,
    backgroundColor: '#BFE7FF',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderBottomRightRadius: 8,
    borderTopLeftRadius: 10,
    zIndex: 10,
  },
  overnightBadgeText: { fontSize: 12, fontWeight: '800', color: '#0B4F71', letterSpacing: 0.5 },
  respondedBadge: { backgroundColor: '#0984E320', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, alignSelf: 'flex-start', marginTop: 6 },
  respondedBadgeText: { color: '#0984E3', fontSize: 13, fontWeight: '700' },
  detailsBtn: { marginTop: spacing.sm, borderWidth: 1.5, borderColor: '#FF2D55', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 16, alignSelf: 'flex-start' },
  detailsBtnText: { fontSize: 15, fontWeight: '700', color: '#FF2D55' },
});

export default PostCard;
