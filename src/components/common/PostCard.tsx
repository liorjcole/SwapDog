import React, { memo, useCallback } from 'react';
import { View, Text, TouchableOpacity, Image, Animated, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../../contexts/ThemeContext';
import { smartDate, isSameDay } from '../../utils/dateHelpers';
import { spacing, borderRadius, shadow } from '../../config/theme';
import { SwapPost } from '../../models/types';

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

/** Map dogIds to display names using post.dogIds/dogNames arrays */
function resolveDogNames(dogIds: string[], post: SwapPost): string {
  if (!dogIds.length || !post.dogIds || !post.dogNames) return '';
  const names = dogIds.map(id => {
    const idx = post.dogIds!.indexOf(id);
    return idx >= 0 ? post.dogNames![idx] : '';
  }).filter(Boolean);
  return names.join(', ');
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
  const startStr = smartDate(post.startDate);
  const endStr = smartDate(post.endDate, { includeYear: true });

  const careLabel = post.careType ? getCareTypeLabel(post.careType) : 'Pet Care';

  return (
    // Dim the entire card when claimed — mirrors the past-commitments dim in RequestsScreen (~L769)
    <Animated.View style={[isHighlighted && pulseScale && glowOpacity ? { transform: [{ scale: pulseScale }], shadowColor: '#FFFFFF', shadowOpacity: glowOpacity as unknown as number, shadowRadius: 20, shadowOffset: { width: 0, height: 0 }, elevation: 10 } : undefined, isClaimed ? { opacity: 0.55 } : undefined]}>
    <TouchableOpacity
      style={[styles.postCard, { backgroundColor: isOwnPost ? '#1A0A10' : colors.surface, ...shadow.sm, ...(isFavorited && !isOwnPost ? { borderWidth: 2, borderColor: '#FFD700' } : {}), ...(isOwnPost ? { borderWidth: 1.5, borderColor: RED + '80' } : {}) }]}
      onPress={handlePostPress}
      accessibilityRole="button"
      accessibilityLabel={`Post for ${post.dogName}`}
    >
      <View style={styles.postCardInner}>
        {/* Own post badge — top right (takes precedence; never double-badge with Claimed) */}
        {isOwnPost && (
          <View style={{ position: 'absolute', top: -1, right: -1, backgroundColor: RED, paddingHorizontal: 10, paddingVertical: 4, borderBottomLeftRadius: 8, borderTopRightRadius: 10, zIndex: 10 }}>
            <Text style={{ fontSize: 12, fontWeight: '800', color: '#FFFFFF', letterSpacing: 0.5 }}>YOUR POST</Text>
          </View>
        )}
        {/* Favorited badge — top right */}
        {isFavorited && !isOwnPost && (
          <View style={{ position: 'absolute', top: -1, right: -1, backgroundColor: '#FFD700', paddingHorizontal: 10, paddingVertical: 4, borderBottomLeftRadius: 8, borderTopRightRadius: 10, zIndex: 10 }}>
            <Text style={{ fontSize: 12, fontWeight: '800', color: '#000000', letterSpacing: 0.5 }}>FAVORITE</Text>
          </View>
        )}
        {/* Claimed badge — gray, top right; only shown to non-owners (YOUR POST takes precedence) */}
        {isClaimed && !isOwnPost && !isFavorited && (
          <View style={{ position: 'absolute', top: -1, right: -1, backgroundColor: '#78909C', paddingHorizontal: 10, paddingVertical: 4, borderBottomLeftRadius: 8, borderTopRightRadius: 10, zIndex: 10 }}>
            <Text style={{ fontSize: 12, fontWeight: '800', color: '#FFFFFF', letterSpacing: 0.5 }}>🔒 Claimed</Text>
          </View>
        )}
        {/* Dog photos + names row */}
        <View style={styles.cardHeader}>
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
              {isFavorited && <Text style={{ color: '#FFD700' }}>★ </Text>}
              {post.dogNames && post.dogNames.length > 1
                ? post.dogNames.join(' & ')
                : post.dogName}
            </Text>
            <Text style={[styles.dateRange, { color: colors.textSecondary }]}>{isSameDay(post.startDate, post.endDate) ? startStr : `${startStr} – ${endStr}`}</Text>
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

        {/* ── Full Care Details ── */}
        <View style={{ marginTop: 8, borderTopWidth: 0.5, borderTopColor: colors.border, paddingTop: 8 }}>
          {/* Primary care type */}
          <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 4 }}>
            {careLabel}
          </Text>

          {/* Day sitting / overnight times */}
          {(post.careType === 'daySitting' || post.careType === 'overnight') && post.startTime && post.endTime && (
            <Text style={{ fontSize: 14, color: colors.textSecondary, marginBottom: 2 }}>
              🕐  {post.startTime} – {post.endTime}
            </Text>
          )}

          {/* Feeding slots */}
          {post.feedingSlots && post.feedingSlots.length > 0 && (
            <View style={{ marginTop: 6 }}>
              <Text style={{ fontSize: 15, fontWeight: '600', color: colors.text }}>🍽️ Feeding</Text>
              {post.feedingSlots.map((slot, i) => (
                <Text key={i} style={{ fontSize: 14, color: colors.textSecondary, marginLeft: 8, marginTop: 1 }}>
                  {slot.time}{slot.daily ? '  ·  repeat daily' : ''}
                  {slot.dogIds.length > 0 && post.dogNames && post.dogNames.length > 1
                    ? `  ·  ${resolveDogNames(slot.dogIds, post)}`
                    : ''}
                </Text>
              ))}
            </View>
          )}

          {/* Medication slots */}
          {post.medicationSlots && post.medicationSlots.length > 0 && (
            <View style={{ marginTop: 6 }}>
              <Text style={{ fontSize: 15, fontWeight: '600', color: colors.text }}>💊 Medication</Text>
              {post.medicationSlots.map((slot, i) => (
                <Text key={i} style={{ fontSize: 14, color: colors.textSecondary, marginLeft: 8, marginTop: 1 }} numberOfLines={1}>
                  {slot.time}{slot.daily ? '  ·  repeat daily' : ''}{slot.details ? ` — ${slot.details}` : ''}
                  {slot.dogIds.length > 0 && post.dogNames && post.dogNames.length > 1
                    ? `  ·  ${resolveDogNames(slot.dogIds, post)}`
                    : ''}
                </Text>
              ))}
            </View>
          )}

          {/* Walk sessions */}
          {post.walkSessions && post.walkSessions.length > 0 && (
            <View style={{ marginTop: 6 }}>
              <Text style={{ fontSize: 15, fontWeight: '600', color: colors.text }}>🐕 Walks</Text>
              {post.walkSessions.map((ws, i) => {
                const durLabel = ws.durationMins >= 60
                  ? `${Math.floor(ws.durationMins / 60)}h${ws.durationMins % 60 > 0 ? ` ${ws.durationMins % 60}m` : ''}`
                  : `${ws.durationMins}m`;
                return (
                  <Text key={i} style={{ fontSize: 14, color: colors.textSecondary, marginLeft: 8, marginTop: 1 }}>
                    {ws.flexible
                      ? `Flexible · ${durLabel}`
                      : `${ws.startTime} – ${ws.endTime}  (${durLabel})`}{ws.repeatDaily ? '  ·  repeat daily' : ''}
                    {ws.dogIds.length > 0 && post.dogNames && post.dogNames.length > 1
                      ? `  ·  ${resolveDogNames(ws.dogIds, post)}`
                      : ''}
                  </Text>
                );
              })}
            </View>
          )}

          {/* Play sessions */}
          {post.playSessions && post.playSessions.length > 0 && (
            <View style={{ marginTop: 6 }}>
              <Text style={{ fontSize: 15, fontWeight: '600', color: colors.text }}>🎾 Playtime</Text>
              {post.playSessions.map((ps, i) => {
                const durLabel = ps.durationMins >= 60
                  ? `${Math.floor(ps.durationMins / 60)}h${ps.durationMins % 60 > 0 ? ` ${ps.durationMins % 60}m` : ''}`
                  : `${ps.durationMins}m`;
                return (
                  <Text key={i} style={{ fontSize: 14, color: colors.textSecondary, marginLeft: 8, marginTop: 1 }}>
                    {ps.flexible
                      ? `Flexible · ${durLabel}`
                      : `${ps.startTime} – ${ps.endTime}  (${durLabel})`}
                    {ps.repeatDaily ? '  ·  repeat daily' : ''}
                    {ps.dogIds.length > 0 && post.dogNames && post.dogNames.length > 1
                      ? `  ·  ${resolveDogNames(ps.dogIds, post)}`
                      : ''}
                  </Text>
                );
              })}
            </View>
          )}

          {/* Free-text care details */}
          {post.careDetails ? (
            <View style={{ backgroundColor: 'rgba(0,0,0,0.25)', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14, marginTop: 8 }}>
              <Text style={{ fontSize: 16, color: colors.textSecondary, fontStyle: 'italic' }} numberOfLines={3}>
                "{post.careDetails}"
              </Text>
            </View>
          ) : null}


        </View>

        {post.status === 'open' && currentUserId && (post.respondedBy ?? []).some(r => r.userId === currentUserId) && (
          <View style={styles.respondedBadge}>
            <Text style={styles.respondedBadgeText}>Messaged ✓</Text>
          </View>
        )}

        {!hideSeeFullDetails && (
          <View style={[styles.detailsBtn, isFavorited && !isOwnPost && { borderColor: '#FFD700' }]}>
            <Text style={[styles.detailsBtnText, isFavorited && !isOwnPost && { color: '#FFD700' }]}>See Full Details</Text>
          </View>
        )}
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
  respondedBadge: { backgroundColor: '#0984E320', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, alignSelf: 'flex-start', marginTop: 6 },
  respondedBadgeText: { color: '#0984E3', fontSize: 13, fontWeight: '700' },
  detailsBtn: { marginTop: spacing.sm, borderWidth: 1.5, borderColor: '#FF2D55', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 16, alignSelf: 'flex-start' },
  detailsBtnText: { fontSize: 15, fontWeight: '700', color: '#FF2D55' },
});

export default PostCard;

