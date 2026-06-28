/**
 * RequestsScreen (the "My Schedule" tab) — single vertical layout:
 *   1. Happening-now banner stack (pinned) — one focal card per live event,
 *      pink for your post / teal for your commitment, with EventProgressBar.
 *   2. Month calendar (shared by both tabs) that collapses on list scroll
 *      (Discover map-collapse pattern, useNativeDriver: false). Dots: pink for
 *      your posts, teal for commitments. Tap a day to filter both lists.
 *   3. Segmented tabs (pinned): "My Posts" (left, default, pink #FF2D55) |
 *      "My Commitments" (right, teal #2DD4BF, sitter-only: claimedBy === uid).
 *   4. The active tab's list, reusing the existing cells (gold claimed styling
 *      + helper-request badge for My Posts; teal sitter cells for commitments).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  Image,
  Alert,
  Dimensions,
  PanResponder,
  Animated,
  LayoutAnimation,
  UIManager,
  Platform,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import { RequestsStackParamList } from '../../navigation/types';
import { useAuthContext } from '../../contexts/AuthContext';
import { useMessaging } from '../../hooks/useMessaging';
import { useTheme } from '../../contexts/ThemeContext';
import { smartDate, isSameDay, applyTimeString, hasEventStarted } from '../../utils/dateHelpers';
import { useSwaps } from '../../hooks/useSwaps';
import { useReviews } from '../../hooks/useReviews';
import { useCancelCommitment } from '../../hooks/useCancelCommitment';
import { SwapPost } from '../../models/types';
import { spacing, borderRadius, shadow } from '../../config/theme';
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../config/firebase';
import EmptyStateView from '../../components/common/EmptyStateView';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import { cancelSwapReminders } from '../../services/ReminderService';
import EventProgressBar from '../../components/common/EventProgressBar';
import HappeningNowBanner from '../../components/common/HappeningNowBanner';
import { useHappeningNow } from '../../hooks/useHappeningNow';
import { getCareTypeIcon } from '../../utils/careTypeHelpers';

// ── Context accent tokens ─────────────────────────────────────────────────────
const RED = '#FF2D55';   // My Posts / your dog being cared for (= colors.primary)
const TEAL = '#2DD4BF';  // My Commitments / you caring for someone's dog

// ── Collapsing-calendar tuning (mirrors the Discover map-collapse) ────────────
// Height animates between MAX (measured calendar height) and MIN (fully
// collapsed). useNativeDriver MUST be false — height is a layout property.
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const CAL_HEIGHT_MIN = 0; // full collapse — list fills the whole screen on scroll-up
const CAL_HEIGHT_ESTIMATE = 380;     // initial guess until measured via onLayout
const CAL_COLLAPSE_DURATION = 250;   // ms, matches Discover



function getCareTypeSummary(post: SwapPost): string {
  switch (post.careType) {
    case 'overnight': {
      const MS_PER_DAY = 1000 * 60 * 60 * 24;
      const nights = Math.max(1, Math.round(
        (post.endDate.getTime() - post.startDate.getTime()) / MS_PER_DAY
      ));
      const startStr = smartDate(post.startDate);
      const endStr = smartDate(post.endDate);
      return `${startStr} → ${endStr} (${nights} night${nights !== 1 ? 's' : ''})`;
    }
    case 'daySitting': {
      const dateStr = smartDate(post.startDate);
      if (post.startTime && post.endTime) return `${dateStr}, ${post.startTime} → ${post.endTime}`;
      return dateStr;
    }
    case 'feeding': {
      const dateStr = smartDate(post.startDate);
      return post.feedingTime ? `${dateStr} at ${post.feedingTime}` : dateStr;
    }
    case 'dogWalking': {
      if (post.walkDurationMinutes) {
        const hrs = Math.floor(post.walkDurationMinutes / 60);
        const mins = post.walkDurationMinutes % 60;
        return hrs > 0
          ? `${hrs} hr${hrs !== 1 ? 's' : ''}${mins > 0 ? ` ${mins} min` : ''} walk`
          : `${mins} min walk`;
      }
      return 'Walk';
    }
    default: {
      if (isSameDay(post.startDate, post.endDate)) {
        return smartDate(post.startDate);
      }
      const startStr = smartDate(post.startDate);
      const endStr = smartDate(post.endDate);
      return `${startStr} – ${endStr}`;
    }
  }
}

const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// SCREEN_WIDTH + SCREEN_HEIGHT destructured above (module scope)
const CAL_H_PADDING = spacing.md * 2;
const CELL_WIDTH = Math.floor((SCREEN_WIDTH - CAL_H_PADDING) / 7);

type Props = {
  navigation: NativeStackNavigationProp<RequestsStackParamList, 'Requests'>;
};

type TabType = 'mine' | 'commitments';

/** First comma-segment of a stored location label, trimmed. "" when absent/blank. */
function cityFromLocationName(name?: string): string {
  return (name?.split(',')[0] ?? '').trim();
}

// ── Date helpers ──────────────────────────────────────────────────────────────
function overlapsDate(post: SwapPost, date: Date): boolean {
  const cell = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const start = new Date(post.startDate.getFullYear(), post.startDate.getMonth(), post.startDate.getDate());
  const end = new Date(post.endDate.getFullYear(), post.endDate.getMonth(), post.endDate.getDate());
  return start <= cell && cell <= end;
}


// ─────────────────────────────────────────────────────────────────────────────

const RequestsScreen: React.FC<Props> = ({ navigation }) => {
  const { colors } = useTheme();
  const { user } = useAuthContext();
  const { getMyPosts, cancelPost, getAcceptedPosts, getCompletedCommitments, isPostExpired, isStartExpiredNoHelper } = useSwaps();
  const { hasReviewed } = useReviews();
  const { cancelCommitment } = useCancelCommitment();
  const { getOrCreateConversation } = useMessaging();

  const [tab, setTab] = useState<TabType>('mine');
  const [expandedCommitId, setExpandedCommitId] = useState<string | null>(null);

  // Enable LayoutAnimation on Android
  if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
    UIManager.setLayoutAnimationEnabledExperimental(true);
  }

  // Re-evaluate the "Happening now" banner stack on the same 60s cadence the
  // EventProgressBar ticks, so live banners appear/disappear without a refresh.
  const [nowTick, setNowTick] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Swipe between tabs
  const tabPanResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gs) =>
        Math.abs(gs.dx) > 30 && Math.abs(gs.dy) < Math.abs(gs.dx),
      onPanResponderRelease: (_, gs) => {
        if (gs.dx < -50) {
          setTab('commitments');
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        } else if (gs.dx > 50) {
          setTab('mine');
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }
      },
    }),
  ).current;
  const [myPosts, setMyPosts] = useState<SwapPost[]>([]);
  const [archivedPosts, setArchivedPosts] = useState<SwapPost[]>([]);
  const [reviewedPostIds, setReviewedPostIds] = useState<Set<string>>(new Set());
  const [acceptedPosts, setAcceptedPosts] = useState<SwapPost[]>([]);
  // Completed caregiver commitments (status==='completed' drops out of
  // getAcceptedPosts, so they are tracked separately).
  const [completedCommitments, setCompletedCommitments] = useState<SwapPost[]>([]);
  // Which completed commitments the caregiver has already reviewed (targetType 'owner').
  const [reviewedCaregiverPostIds, setReviewedCaregiverPostIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Calendar state — default to current month, no day filter selected.
  const today = new Date();
  // selectedDay drives BOTH the calendar highlight and the list day-filter.
  // null = no filter (show all). Tapping a day toggles it on/off.
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [calMonth, setCalMonth] = useState<Date>(
    new Date(today.getFullYear(), today.getMonth(), 1),
  );

  // ── Collapsing calendar (copied from Discover map-collapse) ────────────────
  // calHeightAnim animates the calendar's height on scroll; calCollapsed is a
  // one-shot-per-direction latch so the animation fires once, not per event.
  const calHeightAnim = useRef(new Animated.Value(CAL_HEIGHT_ESTIMATE)).current;
  const calMaxHeight = useRef<number>(CAL_HEIGHT_ESTIMATE);
  const calCollapsed = useRef(false);

  // Measure the calendar's natural height once laid out → becomes CAL_HEIGHT_MAX.
  const onCalLayout = (e: { nativeEvent?: { layout?: { height?: number } } }) => {
    const h = e?.nativeEvent?.layout?.height ?? 0;
    if (h > 0 && Math.abs(h - calMaxHeight.current) > 1) {
      calMaxHeight.current = h;
      if (!calCollapsed.current) calHeightAnim.setValue(h);
    }
  };

  // Drives the collapse from the active list's onScroll — verbatim Discover logic.
  const handleListScroll = (event: { nativeEvent?: { contentOffset?: { y?: number } } }) => {
    const y = event?.nativeEvent?.contentOffset?.y ?? 0;
    if (y > 10 && !calCollapsed.current) {
      calCollapsed.current = true;
      Animated.timing(calHeightAnim, {
        toValue: CAL_HEIGHT_MIN,
        duration: CAL_COLLAPSE_DURATION,
        useNativeDriver: false, // REQUIRED — height is a layout property
      }).start();
    } else if (y <= 2 && calCollapsed.current) {
      calCollapsed.current = false;
      Animated.timing(calHeightAnim, {
        toValue: calMaxHeight.current,
        duration: CAL_COLLAPSE_DURATION,
        useNativeDriver: false,
      }).start();
    }
  };

  // Pan responder for horizontal swipe to change month
  const calPanResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) =>
        Math.abs(gestureState.dx) > 20 && Math.abs(gestureState.dy) < Math.abs(gestureState.dx),
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dx < -30) {
          setCalMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
        } else if (gestureState.dx > 30) {
          setCalMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
        }
      },
    }),
  ).current;

  const fetchPosts = useCallback(async () => {
    if (!user) return;
    try {
      const [mine, accepted, completedSitter] = await Promise.all([
        getMyPosts(user.uid),
        getAcceptedPosts(user.uid),
        getCompletedCommitments(user.uid),
      ]);
      const nonCancelled = mine.filter((p: any) => p.status !== 'cancelled' || (p as any).lateCancelled);
      const active = nonCancelled.filter((p: SwapPost) =>
        !isPostExpired(p) &&
        !isStartExpiredNoHelper(p) &&     // hide start-expired unclaimed posts from active
        p.status !== 'completed' &&
        p.status !== 'cancelled'
      );
      const archived = nonCancelled.filter((p: SwapPost) =>
        isPostExpired(p) ||
        isStartExpiredNoHelper(p) ||      // start-expired unclaimed → Archive
        p.status === 'completed' ||
        (p.status === 'cancelled' && (p as any).lateCancelled)
      );
      // Sort active: unclaimed first (earliest → latest start), then claimed (earliest → latest start).
      // Mirrors the applyTimeString pattern used by isPostInProgress / EventProgressBar.
      const effectiveStartMs = (p: SwapPost): number => {
        if (!p.startDate) return Infinity; // guard: sort missing-date to end
        const d = new Date(p.startDate);
        if (p.startTime) applyTimeString(d, p.startTime);
        else d.setHours(0, 0, 0, 0);
        return d.getTime();
      };
      const byStart = (a: SwapPost, b: SwapPost) => effectiveStartMs(a) - effectiveStartMs(b);
      const unclaimedActive = active.filter((p: SwapPost) => p.status !== 'claimed').sort(byStart);
      const claimedActive   = active.filter((p: SwapPost) => p.status === 'claimed').sort(byStart);
      // Sort archived: completed first, then by date
      archived.sort((a, b) => {
        if (a.status === 'completed' && b.status !== 'completed') return -1;
        if (a.status !== 'completed' && b.status === 'completed') return 1;
        return b.endDate.getTime() - a.endDate.getTime();
      });
      setMyPosts([...unclaimedActive, ...claimedActive]);
      setArchivedPosts(archived);

      // Check review status for completed posts
      const completedPosts = archived.filter((p) => p.status === 'completed' || (p.status === 'cancelled' && (p as any).lateCancelled));
      if (user && completedPosts.length > 0) {
        const reviewed = new Set<string>();
        await Promise.all(
          completedPosts.map(async (p) => {
            try {
              const done = await hasReviewed(p.id, user.uid, 'caregiver');
              if (done) reviewed.add(p.id);
            } catch {}
          })
        );
        setReviewedPostIds(reviewed);
      }
      // ── Mark expired claimed commitments as completed (idempotent, Bug 1 fix) ──
      // getAcceptedPosts only returns status==='claimed' posts for this user (as
      // owner OR sitter). Any of those whose end datetime has passed should
      // transition to 'completed' so the Cloud Function (onPostCompleted) fires
      // and writes pendingReview to both participants' user docs.
      const expiredClaimed = accepted.filter((p) => isPostExpired(p));
      if (expiredClaimed.length > 0) {
        await Promise.all(
          expiredClaimed.map((p) =>
            updateDoc(doc(db, 'swapPosts', p.id), {
              status: 'completed',
              updatedAt: serverTimestamp(),
            }).catch((err) =>
              console.error('[fetchPosts] Failed to mark post completed:', p.id, err)
            )
          )
        );
      }

      setAcceptedPosts(accepted);

      // ── Caregiver completed commitments ───────────────────────────────────
      // Sitter-only: filter to posts where this user was the caregiver.
      const myCompletedCommitments = completedSitter.filter(
        (p) => p.claimedBy === user.uid
      );
      setCompletedCommitments(myCompletedCommitments);

      // Check which completed commitments the caregiver has already reviewed
      // (check for the 'owner' target, which is the final step of the caregiver
      // review flow — if that exists, the whole review was submitted).
      if (myCompletedCommitments.length > 0) {
        const reviewed = new Set<string>();
        await Promise.all(
          myCompletedCommitments.map(async (p) => {
            try {
              const done = await hasReviewed(p.id, user.uid, 'owner');
              if (done) reviewed.add(p.id);
            } catch { /* non-fatal */ }
          })
        );
        setReviewedCaregiverPostIds(reviewed);
      } else {
        setReviewedCaregiverPostIds(new Set());
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useFocusEffect(useCallback(() => { fetchPosts(); }, [fetchPosts]));

  // Commitment reminders (1h/10min) are now scheduled server-side
  // (onHelpConfirmed → scheduleReminders, processReminders cron). The old
  // sitter-side local scheduling was removed to avoid duplicate/mistimed pushes.

  // ── Cancel post ───────────────────────────────────────────────────────────
  const handleCancel = async (postId: string) => {
    Alert.alert('Cancel Post', 'Remove your post from the area feed?', [
      { text: 'No', style: 'cancel' },
      {
        text: 'Cancel Post',
        style: 'destructive',
        onPress: async () => {
          const postToCancel = myPosts.find((p) => p.id === postId);
          if (postToCancel) {
            const allIds = [
              ...(postToCancel.reminderNotificationIds ?? []),
              ...(postToCancel.sitterReminderNotificationIds ?? []),
            ];
            if (allIds.length > 0) {
              cancelSwapReminders(allIds).catch((e) =>
                console.warn('[RequestsScreen] cancelSwapReminders failed:', e),
              );
            }
          }
          await cancelPost(postId);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          fetchPosts();
        },
      },
    ]);
  };

  const compensationLabel = (post: SwapPost): string => {
    if (post.compensationType === 'points') {
      return `${post.pointsCost.toFixed(1)} pt${post.pointsCost !== 1 ? 's' : ''}`;
    }
    // Legacy posts with per-hour/per-day rate
    if (post.totalPayment && post.paymentAmount && post.totalUnits && post.paymentRate) {
      const rateLabel = post.paymentRate === 'per_hour' ? '/hr' : '/day';
      const unitLabel =
        post.paymentRate === 'per_hour'
          ? `${post.totalUnits} hr${post.totalUnits !== 1 ? 's' : ''}`
          : `${post.totalUnits} day${post.totalUnits !== 1 ? 's' : ''}`;
      return `$${post.totalPayment} total ($${post.paymentAmount}${rateLabel} × ${unitLabel})`;
    }
    // New flat-rate posts (no paymentRate field)
    if (post.totalPayment) {
      return `$${post.totalPayment} for the job`;
    }
    if (post.paymentAmount) {
      return `$${post.paymentAmount} for the job`;
    }
    return 'Payment offered';
  };

  // ── My Posts card ─────────────────────────────────────────────────────────
  const renderMyPost = ({ item }: { item: SwapPost }) => {
    const startStr = smartDate(item.startDate);
    const endStr = smartDate(item.endDate, { includeYear: true });
    const isOpen = item.status === 'open';
    const isClaimed = item.status === 'claimed';
    const interestedCount = item.respondedBy?.length ?? 0;
    const statusColor: Record<SwapPost['status'], string> = {
      open: '#00B894',
      claimed: '#FDCB6E',
      completed: '#4ECDC4',
      cancelled: '#636E72',
    };

    return (
      <TouchableOpacity
        style={[styles.card, { backgroundColor: isClaimed ? '#FFF8E1' : colors.surface, ...shadow.sm, borderWidth: isClaimed ? 1.5 : 0, borderColor: isClaimed ? '#FDCB6E' : 'transparent' }]}
        onPress={() => navigation.navigate('PostDetail', { postId: item.id })}
        accessibilityRole="button"
        accessibilityLabel={`Your post for ${(item.dogNames && item.dogNames.length > 0) ? item.dogNames.join(' & ') : item.dogName}`}
      >

        {isClaimed && (
          <View style={{ backgroundColor: '#FDCB6E', paddingVertical: 6, paddingHorizontal: 12, borderTopLeftRadius: 12, borderTopRightRadius: 12, alignItems: 'center', marginTop: -spacing.md, marginHorizontal: -spacing.md }}>
            <Text style={{ color: '#5D4E00', fontSize: 15, fontWeight: '800', letterSpacing: 0.5 }}>
              CLAIMED
            </Text>
          </View>
        )}

        {isOpen && interestedCount > 0 && (
          <View style={styles.interestTopLeft}>
            <Text style={styles.interestBadgeText}>
              {interestedCount} helper{interestedCount !== 1 ? 's' : ''} interested — tap to see
            </Text>
          </View>
        )}
        <View style={[styles.cardHeader, isClaimed && { marginTop: spacing.sm }]}>
          {(() => {
            const photos = (item.dogPhotoURLs && item.dogPhotoURLs.length > 0)
              ? item.dogPhotoURLs
              : (item.dogPhotoURL ? [item.dogPhotoURL] : []);
            return photos.length > 0 ? (
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                {photos.map((url: string, idx: number) => (
                  <Image
                    key={idx}
                    source={{ uri: url }}
                    style={[
                      styles.dogThumbSmall,
                      { borderColor: colors.border },
                      idx > 0 && { marginLeft: -12 },
                    ]}
                  />
                ))}
              </View>
            ) : (
              <View style={[styles.dogThumbPlaceholder, { backgroundColor: colors.primary + '15' }]}>
                <Text style={styles.dogThumbEmoji}>D</Text>
              </View>
            );
          })()}
          <View style={styles.headerInfo}>
            <Text style={[styles.posterName, { color: isClaimed ? '#5D4E00' : colors.text }]}>
              {(item.dogNames && item.dogNames.length > 0) ? item.dogNames.join(' & ') : item.dogName}
            </Text>

          </View>
          <View style={[styles.statusBadge, { backgroundColor: statusColor[item.status] + '25' }]}>
            <Text style={[styles.statusBadgeText, { color: statusColor[item.status] }]}>
              {item.status.toUpperCase()}
            </Text>
          </View>
        </View>

        {/* Wave 19B: Care type icon + summary */}
        <View style={styles.careTypeRow}>
          <Text style={[styles.careTypeIcon, isClaimed ? { opacity: 0.7 } : undefined]}>{getCareTypeIcon(item.careType)}</Text>
          <Text style={[styles.careTypeSummaryText, { color: isClaimed ? '#8B7500' : colors.textSecondary }]}>
            {getCareTypeSummary(item)}
          </Text>
        </View>

        <Text style={[styles.compPlainText, { color: isClaimed ? '#5D4E00' : '#FFFFFF' }]}>
          {compensationLabel(item)}
        </Text>

        {cityFromLocationName(item.posterLocationName) !== '' && (
          <Text style={[styles.postedInLabel, { color: colors.textSecondary }]}>
            Posted in {cityFromLocationName(item.posterLocationName)}
          </Text>
        )}

        {/* ── In-Progress Time Bar ── */}
        <EventProgressBar
          post={item}
          style={{ marginTop: spacing.sm, marginHorizontal: -spacing.md, marginBottom: -spacing.md }}
        />
      </TouchableOpacity>
    );
  };

  // ── Archived post card (grayed out, with completed/review status) ────────
  const renderArchivedPost = ({ item }: { item: SwapPost }) => {
    const startStr = smartDate(item.startDate);
    const endStr = smartDate(item.endDate, { includeYear: true });
    const isCompleted = item.status === 'completed';
    const isReviewed = reviewedPostIds.has(item.id);
    // True when a post's start moment passed with no confirmed helper.
    // Mutually exclusive with COMPLETED / LATE CANCELLED banners.
    const isUnclaimedExpired =
      !item.claimedBy &&
      item.status !== 'completed' &&
      !((item as any).lateCancelled) &&
      (isStartExpiredNoHelper(item) || isPostExpired(item));

    return (
      <TouchableOpacity
        style={[styles.card, { backgroundColor: colors.surface, ...shadow.sm, opacity: 0.5 }]}
        onPress={() => navigation.navigate('PostDetail', { postId: item.id })}
        accessibilityRole="button"
        accessibilityLabel={`Archived post for ${(item.dogNames && item.dogNames.length > 0) ? item.dogNames.join(' & ') : item.dogName}`}
      >
        {/* Status label */}
        {isCompleted && (
          <View style={{ backgroundColor: '#0984E320', paddingVertical: 5, paddingHorizontal: 12, borderTopLeftRadius: 12, borderTopRightRadius: 12, alignItems: 'center', marginTop: -spacing.md, marginHorizontal: -spacing.md }}>
            <Text style={{ color: '#0984E3', fontSize: 14, fontWeight: '700', letterSpacing: 0.5 }}>
              COMPLETED
            </Text>
          </View>
        )}
        {!isCompleted && item.status === 'cancelled' && (item as any).lateCancelled && (
          <View style={{ backgroundColor: '#FF2D5520', paddingVertical: 5, paddingHorizontal: 12, borderTopLeftRadius: 12, borderTopRightRadius: 12, alignItems: 'center', marginTop: -spacing.md, marginHorizontal: -spacing.md }}>
            <Text style={{ color: '#FF2D55', fontSize: 14, fontWeight: '700', letterSpacing: 0.5 }}>
              LATE CANCELLED
            </Text>
          </View>
        )}

        <View style={[styles.cardHeader, isCompleted ? { marginTop: spacing.sm } : undefined]}>
          {(() => {
            const photos = (item.dogPhotoURLs && item.dogPhotoURLs.length > 0)
              ? item.dogPhotoURLs
              : (item.dogPhotoURL ? [item.dogPhotoURL] : []);
            return photos.length > 0 ? (
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                {photos.map((url: string, idx: number) => (
                  <Image
                    key={idx}
                    source={{ uri: url }}
                    style={[
                      styles.dogThumbSmall,
                      { borderColor: colors.border },
                      idx > 0 && { marginLeft: -12 },
                    ]}
                  />
                ))}
              </View>
            ) : (
              <View style={[styles.dogThumbPlaceholder, { backgroundColor: colors.primary + '15' }]}>
                <Text style={styles.dogThumbEmoji}>D</Text>
              </View>
            );
          })()}
          <View style={styles.headerInfo}>
            <Text style={[styles.posterName, { color: colors.textSecondary }]}>
              {(item.dogNames && item.dogNames.length > 0) ? item.dogNames.join(' & ') : item.dogName}
            </Text>
            <Text style={{ fontSize: 15, color: colors.textSecondary }}>
              {isSameDay(item.startDate, item.endDate) ? startStr : `${startStr} — ${endStr}`}
            </Text>
          </View>
        </View>

        {/* Review button for completed OR late-cancelled posts */}
        {(isCompleted || (item.status === 'cancelled' && (item as any).lateCancelled)) && (
          <View style={{ marginTop: 8 }}>
            {isReviewed ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 8 }}>
                <Text style={{ color: '#00B894', fontSize: 16, fontWeight: '600' }}>✓ Reviewed</Text>
              </View>
            ) : (item.status === 'cancelled' && (item as any).lateCancelled) ? (
              <TouchableOpacity
                style={{ backgroundColor: '#FF2D55', borderRadius: 10, paddingVertical: 10, alignItems: 'center' }}
                onPress={() => navigation.navigate('WriteReview', {
                  swapRequestId: item.id,
                  revieweeId: (item as any).acceptedSitterId ?? '',
                  reviewRole: 'owner',
                  lateCancellation: true,
                })}
                accessibilityLabel="Review late cancellation"
                accessibilityRole="button"
              >
                <Text style={{ color: '#fff', fontSize: 17, fontWeight: '700' }}>⚠️ Review Late Cancellation</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={{ backgroundColor: '#0984E3', borderRadius: 10, paddingVertical: 10, alignItems: 'center' }}
                onPress={async () => {
                  // Fetch sitter name on demand (not stored on the post doc).
                  const claimedByUid = item.claimedBy ?? '';
                  let otherUserName = 'your caregiver';
                  if (claimedByUid) {
                    try {
                      const snap = await getDoc(doc(db, 'users', claimedByUid));
                      const d = snap.data();
                      if (d) otherUserName = (d.displayName as string) || otherUserName;
                    } catch { /* keep fallback */ }
                  }
                  // Navigate within the Requests stack — goBack() after submit
                  // returns to the Schedule list, not the Profile tab.
                  navigation.navigate('Review', {
                    postId: item.id,
                    role: 'owner' as const,
                    otherUserId: claimedByUid,
                    otherUserName,
                    dogIds: item.dogIds ?? (item.dogId ? [item.dogId] : []),
                    dogNames: item.dogNames ?? [item.dogName],
                  });
                }}
                accessibilityLabel="Leave a review"
                accessibilityRole="button"
              >
                <Text style={{ color: '#fff', fontSize: 17, fontWeight: '700' }}>Leave Review</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* UNCLAIMED corner badge — mirrors the FAVORITE badge geometry in DiscoverScreen */}
        {isUnclaimedExpired && (
          <View style={{
            position: 'absolute', top: -1, right: -1,
            backgroundColor: '#78909C',
            paddingHorizontal: 10, paddingVertical: 4,
            borderBottomLeftRadius: 8, borderTopRightRadius: 10,
            zIndex: 10,
          }}>
            <Text style={{ fontSize: 12, fontWeight: '800', color: '#FFFFFF', letterSpacing: 0.5 }}>
              UNCLAIMED
            </Text>
          </View>
        )}

        {cityFromLocationName(item.posterLocationName) !== '' && (
          <Text style={[styles.postedInLabel, { color: colors.textSecondary }]}>
            Posted in {cityFromLocationName(item.posterLocationName)}
          </Text>
        )}
      </TouchableOpacity>
    );
  };

  // ── Calendar helpers ──────────────────────────────────────────────────────
  const prevMonth = () =>
    setCalMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1));
  const nextMonth = () =>
    setCalMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1));

  /** Build array of Date|null for the calendar grid (null = empty leading cell). */
  const buildCalendarDays = (): (Date | null)[] => {
    const year = calMonth.getFullYear();
    const month = calMonth.getMonth();
    const firstDow = new Date(year, month, 1).getDay(); // 0 = Sunday
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: (Date | null)[] = [];
    for (let i = 0; i < firstDow; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  };

  // ── Day filter ───────────────────────────────────────────────────────
  // When a calendar day is selected, both tab lists filter to posts occurring
  // that day; otherwise the full list is shown.
  const filterByDay = (posts: SwapPost[]): SwapPost[] =>
    selectedDay ? posts.filter((p) => overlapsDate(p, selectedDay)) : posts;

  // Sitter-only commitments (you're caring for someone's dog). Owner-side
  // claimed posts now live under My Posts with the gold claimed styling.
  const sitterCommitments = acceptedPosts.filter((p) => p.claimedBy === user?.uid);

  /**
   * Dot presence for a calendar day:
   *   red  = one of your own posts (My Posts) falls on this day
   *   teal = one of your sitter commitments falls on this day
   * "Falls on" spans the full [startDate, endDate] range (multi-day overnights).
   */
  const getDotsForDate = (date: Date): { red: boolean; teal: boolean } => {
    let red = false;
    let teal = false;
    for (const post of myPosts) {
      if (overlapsDate(post, date)) { red = true; break; }
    }
    for (const post of sitterCommitments) {
      if (overlapsDate(post, date)) { teal = true; break; }
    }
    return { red, teal };
  };

  // Sitter commitments partitioned into upcoming/past, after the day filter.
  const upcomingCommitments = filterByDay(sitterCommitments)
    .filter((p) => !isPostExpired(p))
    .sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
  const pastCommitments = filterByDay(sitterCommitments)
    .filter((p) => isPostExpired(p))
    .sort((a, b) => b.startDate.getTime() - a.startDate.getTime());

  // Completed caregiver commitments respect the active day filter.
  const completedToShow = filterByDay(completedCommitments)
    .sort((a, b) => b.endDate.getTime() - a.endDate.getTime());

  // Banner events from shared hook (own lightweight fetch + 60s tick).
  const { liveEvents } = useHappeningNow();

  // Toggle the calendar day filter: tap to select, tap the same day to clear.
  const handleDatePress = (date: Date) => {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    setSelectedDay((prev) => (prev && isSameDay(prev, d) ? null : d));
  };


  // ── Commitment card ───────────────────────────────────────────────────────
  const handleMessageFromCommitment = async (post: SwapPost) => {
    if (!user?.uid) return;
    const isMyDog = post.posterId === user.uid;
    const otherUserId = isMyDog ? post.claimedBy : post.posterId;
    if (!otherUserId) return;
    try {
      const convId = await getOrCreateConversation(user.uid, otherUserId, post.id);
      navigation.navigate('Chat', { conversationId: convId, otherUserId });
    } catch (err) {
      console.warn('[RequestsScreen] Failed to open chat:', err);
    }
  };

  // Delegates to the shared 24h-aware cancel flow (single source of truth).
  const handleCancelCommitment = (post: SwapPost) => {
    cancelCommitment(post, { onCancelled: () => fetchPosts() });
  };

  const toggleExpand = (postId: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedCommitId((prev) => (prev === postId ? null : postId));
  };

  const renderCommitmentCard = (post: SwapPost, onCardPress?: () => void, opts?: { dimmed?: boolean }) => {
    const isMyDog = post.posterId === user?.uid;
    // Mute the accent to a neutral border color for past (expired) commitments
    const accentColor = opts?.dimmed ? colors.border : (isMyDog ? RED : TEAL);
    const roleLabel = isMyDog ? 'Your dog' : "You're booked";
    const otherName = isMyDog
      ? (post.respondedBy?.find((r) => r.userId === post.claimedBy)?.userName ?? 'Your sitter')
      : post.posterName;
    const startStr = smartDate(post.startDate);
    const endStr = smartDate(post.endDate, { includeYear: true });
    const isExpanded = expandedCommitId === post.id;
    const careSummary = getCareTypeSummary(post);

    // Use multi-dog arrays when available, fallback to singular fields
    const allDogNames = (post.dogNames && post.dogNames.length > 0)
      ? post.dogNames
      : [post.dogName];
    const allDogPhotos = (post.dogPhotoURLs && post.dogPhotoURLs.length > 0)
      ? post.dogPhotoURLs
      : (post.dogPhotoURL ? [post.dogPhotoURL] : []);
    const dogNamesDisplay = allDogNames.join(' & ');

    const onPress = onCardPress
      ? onCardPress
      : () => toggleExpand(post.id);

    return (
      <View key={post.id} style={opts?.dimmed ? { opacity: 0.55 } : undefined}>
        <TouchableOpacity
          style={[
            styles.commitCard,
            { backgroundColor: colors.surface, borderLeftColor: accentColor, ...shadow.sm },
            isExpanded && { borderBottomLeftRadius: 0, borderBottomRightRadius: 0, marginBottom: 0 },
          ]}
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={`${roleLabel}: ${dogNamesDisplay} with ${otherName}`}
          accessibilityState={{ expanded: isExpanded }}
        >
          <View style={styles.commitCardInner}>
            {/* Dog photo(s) */}
            {allDogPhotos.length > 0 && (
              <View style={styles.commitDogPhotos}>
                {allDogPhotos.map((url, idx) => (
                  <Image
                    key={idx}
                    source={{ uri: url }}
                    style={[
                      styles.commitDogPhoto,
                      { borderColor: accentColor },
                      idx > 0 && { marginLeft: -10 },
                    ]}
                  />
                ))}
              </View>
            )}
            <View style={[styles.commitInfo, { flex: 1 }]}>
              <Text style={[styles.commitRoleLabel, { color: accentColor }]}>{roleLabel}</Text>
              <Text style={[styles.commitDogName, { color: colors.text }]}>{dogNamesDisplay}</Text>
              <Text style={[styles.commitOther, { color: colors.textSecondary }]}>{otherName}</Text>
              <Text style={[styles.commitDates, { color: colors.textSecondary }]}>
                {isSameDay(post.startDate, post.endDate) ? startStr : `${startStr} – ${endStr}`}
              </Text>
            </View>
            <Text style={[styles.commitArrow, { color: colors.primary }]}>
              {isExpanded ? '⌄' : '›'}
            </Text>
          </View>

          {/* ── In-Progress Time Bar ── */}
          <EventProgressBar
            post={post}
            style={{ marginTop: spacing.sm, marginHorizontal: -spacing.md, marginBottom: -spacing.md }}
          />
        </TouchableOpacity>

        {isExpanded && (
          <View
            style={[
              styles.expandedSection,
              {
                backgroundColor: colors.surface,
                borderLeftColor: accentColor,
                borderTopColor: colors.border,
                ...shadow.sm,
              },
            ]}
          >
            {/* Care type */}
            <View style={styles.expandedRow}>
              <Text style={[styles.expandedLabel, { color: colors.textSecondary }]}>Care</Text>
              <Text style={[styles.expandedValue, { color: colors.text }]}>{careSummary}</Text>
            </View>

            {/* Compensation */}
            <View style={styles.expandedRow}>
              <Text style={[styles.expandedLabel, { color: colors.textSecondary }]}>Compensation</Text>
              <Text style={[styles.expandedValue, { color: '#00B894' }]}>
                {compensationLabel(post)}
              </Text>
            </View>

            {/* Care details */}
            {post.careDetails ? (
              <View style={styles.expandedRow}>
                <Text style={[styles.expandedLabel, { color: colors.textSecondary }]}>Details</Text>
                <Text
                  style={[styles.expandedValue, { color: colors.text }]}
                  numberOfLines={4}
                >
                  {post.careDetails}
                </Text>
              </View>
            ) : null}

            {/* Action buttons */}
            <View style={styles.expandedButtons}>
              <TouchableOpacity
                style={[styles.expandedBtn, { backgroundColor: colors.primary }]}
                onPress={() => handleMessageFromCommitment(post)}
                accessibilityLabel={`Message ${otherName}`}
                accessibilityRole="button"
              >
                <Text style={styles.expandedBtnText}>💬  Message</Text>
              </TouchableOpacity>

              {post.status !== 'completed' && !hasEventStarted(post, nowTick) && (
                <TouchableOpacity
                  style={styles.deleteLink}
                  onPress={() => handleCancelCommitment(post)}
                  accessibilityLabel="Delete commitment"
                  accessibilityRole="button"
                >
                  <Text style={styles.deleteLinkText}>Delete</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}
      </View>
    );
  };

  // ── Completed commitment card (caregiver) ──────────────────────────────────
  // Mirrors renderArchivedPost (owner side) but targets the caregiver role:
  //   review targets = each dog + the owner (post.posterId).
  const renderCompletedCommitmentCard = (post: SwapPost) => {
    const startStr = smartDate(post.startDate);
    const endStr = smartDate(post.endDate, { includeYear: true });
    const isReviewed = reviewedCaregiverPostIds.has(post.id);
    const isLateCancelled = (post as any).lateCancelled as boolean | undefined;

    const dogPhotos = (post.dogPhotoURLs && post.dogPhotoURLs.length > 0)
      ? post.dogPhotoURLs
      : (post.dogPhotoURL ? [post.dogPhotoURL] : []);
    const dogNamesDisplay = (post.dogNames && post.dogNames.length > 0)
      ? post.dogNames.join(' & ')
      : post.dogName;

    return (
      <TouchableOpacity
        key={post.id}
        style={[styles.card, { backgroundColor: colors.surface, ...shadow.sm, opacity: 0.6 }]}
        onPress={() => navigation.navigate('PostDetail', { postId: post.id })}
        accessibilityRole="button"
        accessibilityLabel={`Completed commitment for ${dogNamesDisplay}`}
      >
        {/* Status banner */}
        {isLateCancelled ? (
          <View style={{ backgroundColor: '#FF2D5520', paddingVertical: 5, paddingHorizontal: 12, borderTopLeftRadius: 12, borderTopRightRadius: 12, alignItems: 'center', marginTop: -spacing.md, marginHorizontal: -spacing.md }}>
            <Text style={{ color: '#FF2D55', fontSize: 14, fontWeight: '700', letterSpacing: 0.5 }}>LATE CANCELLED</Text>
          </View>
        ) : (
          <View style={{ backgroundColor: '#0984E320', paddingVertical: 5, paddingHorizontal: 12, borderTopLeftRadius: 12, borderTopRightRadius: 12, alignItems: 'center', marginTop: -spacing.md, marginHorizontal: -spacing.md }}>
            <Text style={{ color: '#0984E3', fontSize: 14, fontWeight: '700', letterSpacing: 0.5 }}>COMPLETED</Text>
          </View>
        )}

        {/* Dog photo(s) + dates */}
        <View style={[styles.cardHeader, { marginTop: spacing.sm }]}>
          {dogPhotos.length > 0 ? (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              {dogPhotos.map((url: string, idx: number) => (
                <Image
                  key={idx}
                  source={{ uri: url }}
                  style={[styles.dogThumbSmall, { borderColor: colors.border }, idx > 0 && { marginLeft: -12 }]}
                />
              ))}
            </View>
          ) : (
            <View style={[styles.dogThumbPlaceholder, { backgroundColor: colors.primary + '15' }]}>
              <Text style={styles.dogThumbEmoji}>D</Text>
            </View>
          )}
          <View style={styles.headerInfo}>
            <Text style={[styles.posterName, { color: colors.textSecondary }]}>{dogNamesDisplay}</Text>
            <Text style={{ fontSize: 15, color: colors.textSecondary }}>
              {isSameDay(post.startDate, post.endDate) ? startStr : `${startStr} — ${endStr}`}
            </Text>
          </View>
        </View>

        {/* Leave Review / Reviewed indicator */}
        <View style={{ marginTop: 8 }}>
          {isReviewed ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 8 }}>
              <Text style={{ color: '#00B894', fontSize: 16, fontWeight: '600' }}>✓ Reviewed</Text>
            </View>
          ) : (
            <TouchableOpacity
              style={{ backgroundColor: '#0984E3', borderRadius: 10, paddingVertical: 10, alignItems: 'center' }}
              onPress={async () => {
                const posterUid = post.posterId ?? '';
                let otherUserName = 'the owner';
                if (posterUid) {
                  try {
                    const snap = await getDoc(doc(db, 'users', posterUid));
                    const d = snap.data();
                    if (d) otherUserName = (d.displayName as string) || otherUserName;
                  } catch { /* keep fallback */ }
                }
                navigation.navigate('Review', {
                  postId: post.id,
                  role: 'caregiver' as const,
                  otherUserId: posterUid,
                  otherUserName,
                  dogIds: post.dogIds ?? (post.dogId ? [post.dogId] : []),
                  dogNames: post.dogNames ?? [post.dogName],
                });
              }}
              accessibilityLabel="Leave a review"
              accessibilityRole="button"
            >
              <Text style={{ color: '#fff', fontSize: 17, fontWeight: '700' }}>Leave Review</Text>
            </TouchableOpacity>
          )}
        </View>
      </TouchableOpacity>
    );
  };


  // ── Commitments tab ───────────────────────────────────────────────────────
  // ── Calendar (shared by both tabs; height animates on scroll) ─────────────
  const renderCalendar = () => {
    const calDays = buildCalendarDays();

    return (
      <View onLayout={onCalLayout} style={styles.calendarBlock}>
        {/* Calendar section — entire area swipeable left/right to change month */}
        <View {...calPanResponder.panHandlers}>
          {/* Month header */}
          <View style={styles.calMonthHeader}>
            <TouchableOpacity
              onPress={prevMonth}
              style={styles.calNavBtn}
              accessibilityLabel="Previous month"
              accessibilityRole="button"
            >
              <Text style={[styles.calNavText, { color: colors.primary }]}>‹</Text>
            </TouchableOpacity>
            <Text style={[styles.calMonthTitle, { color: colors.text }]}>
              {MONTH_NAMES[calMonth.getMonth()]} {calMonth.getFullYear()}
            </Text>
            <TouchableOpacity
              onPress={nextMonth}
              style={styles.calNavBtn}
              accessibilityLabel="Next month"
              accessibilityRole="button"
            >
              <Text style={[styles.calNavText, { color: colors.primary }]}>›</Text>
            </TouchableOpacity>
          </View>

          {/* Day-of-week row */}
          <View style={styles.calDowRow}>
            {DAY_LABELS.map((d, i) => (
              <Text key={i} style={[styles.calDowText, { color: colors.textSecondary }]}>
                {d}
              </Text>
            ))}
          </View>

          {/* Calendar grid — swipeable left/right to change month */}
          <View style={styles.calGrid}>
            {calDays.map((date, idx) => {
              if (date === null) {
                return <View key={`empty-${idx}`} style={styles.calCell} />;
              }
              const dots = getDotsForDate(date);
              const isSelected = selectedDay ? isSameDay(date, selectedDay) : false;
              const isToday = isSameDay(date, today);
              const hasAny = dots.red || dots.teal;

              // Event scheduled: filled circle (red = your post, teal = commitment).
              const commitColor = dots.red ? RED : dots.teal ? TEAL : null;

              return (
                <TouchableOpacity
                  key={idx}
                  style={styles.calCell}
                  onPress={() => handleDatePress(date)}
                  accessibilityLabel={`${date.getDate()} ${MONTH_NAMES[date.getMonth()]}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                >
                  {(() => {
                    if (hasAny) {
                      // Both red + teal on same day: split circle 50/50 vertical
                      if (dots.red && dots.teal) {
                        return (
                          <View style={[styles.calDayCircle, { overflow: 'hidden' }, isSelected && styles.calDaySelectedRing]}>
                            <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '50%', backgroundColor: RED }} />
                            <View style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: '50%', backgroundColor: TEAL }} />
                            <Text style={[styles.calDayNum, { color: '#fff', fontWeight: isSelected ? '800' : '700', fontSize: isSelected ? 18 : 14 }]}>
                              {date.getDate()}
                            </Text>
                          </View>
                        );
                      }
                      // Single color: red = your post, teal = your commitment
                      return (
                        <View style={[styles.calDayCircle, { backgroundColor: commitColor ?? RED }, isSelected && styles.calDaySelectedRing]}>
                          <Text style={[styles.calDayNum, { color: '#fff', fontWeight: isSelected ? '800' : '700', fontSize: isSelected ? 18 : 14 }]}>
                            {date.getDate()}
                          </Text>
                        </View>
                      );
                    }
                    // Normal / selected / today (no event)
                    return (
                      <View style={[
                        styles.calDayCircle,
                        isSelected
                          ? styles.calDaySelectedRing
                          : isToday
                          ? { borderWidth: 1.5, borderColor: colors.primary }
                          : undefined,
                      ]}>
                        <Text style={[
                          styles.calDayNum,
                          { color: colors.text },
                          isSelected && { fontSize: 18, fontWeight: '800' },
                          !isSelected && isToday ? { color: colors.primary, fontWeight: '700' } : undefined,
                        ]}>
                          {date.getDate()}
                        </Text>
                      </View>
                    );
                  })()}
                  {/* Selected: dot underneath */}
                  {isSelected && (
                    <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: colors.textSecondary, marginTop: 2 }} />
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Legend + day-filter affordance */}
        <View style={styles.calLegend}>
          <View style={styles.calLegendItem}>
            <View style={[styles.calDot, { backgroundColor: RED }]} />
            <Text style={[styles.calLegendText, { color: colors.textSecondary }]}>
              Your dog is being cared for
            </Text>
          </View>
          <View style={styles.calLegendItem}>
            <View style={[styles.calDot, { backgroundColor: TEAL }]} />
            <Text style={[styles.calLegendText, { color: colors.textSecondary }]}>
              You're caring for someone's dog
            </Text>
          </View>
          {selectedDay && (
            <TouchableOpacity
              onPress={() => setSelectedDay(null)}
              style={[styles.showAllChip, { borderColor: colors.border }]}
              accessibilityLabel="Show all days"
              accessibilityRole="button"
            >
              <Text style={[styles.showAllChipText, { color: colors.primary }]}>
                {smartDate(selectedDay)} · Show all ✕
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };


  // ─────────────────────────────────────────────────────────────────────────
  if (loading) return <LoadingSpinner />;

  // Tabs: My Posts (left, default, pink) | My Commitments (right, teal).
  const tabs: { key: TabType; label: string; accent: string }[] = [
    { key: 'mine', label: `My Posts${myPosts.length > 0 ? ` (${myPosts.length})` : ''}`, accent: RED },
    {
      key: 'commitments',
      label: `My Commitments${sitterCommitments.length > 0 ? ` (${sitterCommitments.length})` : ''}`,
      accent: TEAL,
    },
  ];

  // Archive footer respects the active day filter.
  const archivedToShow = selectedDay ? filterByDay(archivedPosts) : archivedPosts;

  // My Commitments list rows: upcoming commits, an optional Past divider, then
  // dimmed past commits, and finally completed caregiver commitments with a
  // Leave Review button — all flattened so a single FlatList drives the view.
  type CommitRow =
    | { kind: 'commit'; post: SwapPost; dimmed: boolean }
    | { kind: 'divider' }
    | { kind: 'completed-divider' }
    | { kind: 'completed-commit'; post: SwapPost };

  const commitRows: CommitRow[] = [
    ...upcomingCommitments.map((post) => ({ kind: 'commit' as const, post, dimmed: false })),
    ...(pastCommitments.length > 0 ? [{ kind: 'divider' as const }] : []),
    ...pastCommitments.map((post) => ({ kind: 'commit' as const, post, dimmed: true })),
    ...(completedToShow.length > 0 ? [{ kind: 'completed-divider' as const }] : []),
    ...completedToShow.map((post) => ({ kind: 'completed-commit' as const, post })),
  ];


  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* ── Happening-now banner stack (pinned, focal point) ── */}
      {liveEvents.length > 0 && (
        <View style={styles.bannerStack}>
          {liveEvents.map(({ post, accent, careIcon, contextLabel }) => (
            <HappeningNowBanner
              key={post.id}
              post={post}
              accent={accent}
              careIcon={careIcon}
              contextLabel={contextLabel}
              backgroundColor={colors.surface}
              textColor={colors.text}
              onPress={() => navigation.navigate('PostDetail', { postId: post.id })}
            />
          ))}
        </View>
      )}

      {/* ── Collapsing calendar (height animates on list scroll) ── */}
      <Animated.View style={{ height: calHeightAnim, overflow: 'hidden' }}>
        {renderCalendar()}
      </Animated.View>

      {/* ── Segmented tabs (pinned, context-themed) ── */}
      <View style={[styles.tabs, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        {tabs.map((t) => (
          <TouchableOpacity
            key={t.key}
            style={[
              styles.tab,
              tab === t.key && { borderBottomColor: t.accent, borderBottomWidth: 2 },
            ]}
            onPress={() => setTab(t.key)}
            accessibilityLabel={t.label}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === t.key }}
          >
            <Text
              style={[
                styles.tabText,
                { color: tab === t.key ? t.accent : colors.textSecondary },
              ]}
            >
              {t.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={{ flex: 1 }} {...tabPanResponder.panHandlers}>
      {tab === 'mine' ? (
        <FlatList
            data={filterByDay(myPosts)}
            keyExtractor={(p) => p.id}
            onScroll={handleListScroll}
            scrollEventThrottle={16}
            ListHeaderComponent={
              <TouchableOpacity
                style={styles.postRequestCard}
                onPress={() => navigation.navigate('CreatePost')}
                accessibilityLabel="Create a new post"
                accessibilityRole="button"
              >
                <Text style={styles.postRequestCardText}>Create Post</Text>
              </TouchableOpacity>
            }
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => {
                  setRefreshing(true);
                  fetchPosts();
                }}
              />
            }
            ListEmptyComponent={
              archivedToShow.length === 0 ? (
                <EmptyStateView
                  emoji=""
                  title={selectedDay ? 'No posts this day' : 'No posts yet'}
                  subtitle={selectedDay ? 'Tap “Show all” to clear the filter' : 'Post a request and local sitters will reach out'}
                />
              ) : null
            }
            ListFooterComponent={
              archivedToShow.length > 0 ? (
                <View style={{ marginTop: 24 }}>
                  <Text style={{ color: colors.textSecondary, fontSize: 15, fontWeight: '700', letterSpacing: 1, marginBottom: 12, paddingHorizontal: 4, textTransform: 'uppercase' }}>
                    Archive
                  </Text>
                  {archivedToShow.map((post) => (
                    <View key={post.id}>
                      {renderArchivedPost({ item: post })}
                    </View>
                  ))}
                </View>
              ) : null
            }
            renderItem={renderMyPost}
            contentContainerStyle={styles.list}
          />
      ) : (
        <FlatList
            data={commitRows}
            keyExtractor={(row, idx) => (
              row.kind === 'commit' || row.kind === 'completed-commit'
                ? row.post.id
                : `divider-${idx}`
            )}
            onScroll={handleListScroll}
            scrollEventThrottle={16}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => {
                  setRefreshing(true);
                  fetchPosts();
                }}
              />
            }
            ListEmptyComponent={
              <EmptyStateView
                emoji=""
                title={selectedDay ? 'No commitments this day' : 'No commitments yet'}
                subtitle={selectedDay ? 'Tap “Show all” to clear the filter' : "When you sit someone's dog, it shows here"}
              />
            }
            renderItem={({ item }) => {
              if (item.kind === 'divider') {
                return (
                  <View style={[styles.pastDividerHeader, { borderTopColor: colors.border }]}>
                    <Text style={[styles.selectedDayTitle, { color: colors.textSecondary }]}>
                      Past
                    </Text>
                  </View>
                );
              }
              if (item.kind === 'completed-divider') {
                return (
                  <View style={[styles.pastDividerHeader, { borderTopColor: colors.border }]}>
                    <Text style={[styles.selectedDayTitle, { color: colors.textSecondary }]}>
                      Completed
                    </Text>
                  </View>
                );
              }
              if (item.kind === 'completed-commit') {
                return (
                  <View style={{ marginBottom: spacing.sm }}>
                    {renderCompletedCommitmentCard(item.post)}
                  </View>
                );
              }
              return (
                <View style={{ marginBottom: spacing.sm }}>
                  {renderCommitmentCard(
                    item.post,
                    () => navigation.navigate('PostDetail', { postId: item.post.id }),
                    item.dimmed ? { dimmed: true } : undefined,
                  )}
                </View>
              );
            }}
            contentContainerStyle={styles.list}
          />
      )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },

  // Tab bar
  tabs: { flexDirection: 'row', borderBottomWidth: 1 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: spacing.md },
  tabText: { fontSize: 15, fontWeight: '600' },

  // My Posts list
  list: { padding: spacing.md, paddingBottom: spacing.xl * 3 },

  // Card shared
  card: { borderRadius: borderRadius.lg, padding: spacing.md, marginBottom: spacing.md },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  headerInfo: { flex: 1 },
  posterName: { fontSize: 17, fontWeight: '700' },
  dateRange: { fontSize: 14, marginTop: 1 },
  dogThumbSmall: { width: 44, height: 44, borderRadius: borderRadius.sm, borderWidth: 1 },
  dogThumbPlaceholder: {
    width: 44,
    height: 44,
    borderRadius: borderRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dogThumbEmoji: { fontSize: 22 },
  compBadge: {
    borderWidth: 1.5,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    alignSelf: 'flex-start',
    marginBottom: spacing.xs,
  },
  compBadgeText: { fontSize: 15, fontWeight: '700' },
  statusBadge: { paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: borderRadius.full },
  statusBadgeText: { fontSize: 13, fontWeight: '700' },
  cancelBtn: {
    borderWidth: 1.5,
    borderRadius: borderRadius.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    alignSelf: 'flex-start',
    marginTop: spacing.xs,
  },
  cancelBtnText: { fontSize: 15, fontWeight: '600' },
  // Helpers interested — top left of card
  interestTopLeft: {
    backgroundColor: RED,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    alignSelf: 'flex-start',
    marginBottom: 12,
    shadowColor: RED,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.30,
    shadowRadius: 4,
    elevation: 2,
  },
  interestBadgeText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  // Points — plain bold white text
  compPlainText: { fontSize: 16, fontWeight: '700', marginBottom: spacing.xs },
  postedInLabel: { fontSize: 13, fontStyle: 'italic', textAlign: 'right', marginTop: spacing.xs },
  // Care type row (Wave 19B)
  careTypeRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: spacing.xs },
  careTypeIcon: { fontSize: 16 },
  careTypeSummaryText: { fontSize: 14, fontWeight: '500', flex: 1 },

  // Post Request Card (replaces FAB)
  postRequestCard: {
    backgroundColor: 'transparent',
    borderRadius: borderRadius.lg,
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: spacing.md,
    marginVertical: spacing.lg,
  },
  postRequestCardText: { color: '#FFFFFF', fontSize: 18, fontWeight: '400' },

  // Happening-now banner stack (pinned)
  bannerStack: { paddingHorizontal: spacing.md, paddingTop: spacing.sm },

  // Calendar block (inside the collapsing Animated.View)
  calendarBlock: { paddingHorizontal: spacing.md, paddingTop: spacing.sm },

  // Month nav header
  calMonthHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  calNavBtn: { padding: spacing.sm },
  calNavText: { fontSize: 30, lineHeight: 32 },
  calMonthTitle: { fontSize: 20, fontWeight: '700' },

  // Day-of-week row
  calDowRow: { flexDirection: 'row', marginBottom: spacing.xs },
  calDowText: { width: CELL_WIDTH, textAlign: 'center', fontSize: 14, fontWeight: '600' },

  // Grid
  calGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calCell: {
    width: CELL_WIDTH,
    alignItems: 'center',
    paddingVertical: 3,
  },
  calDayCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calDayNum: { fontSize: 16, fontWeight: '500' },
  calDots: { flexDirection: 'row', gap: 2, marginTop: 1 },
  calDot: { width: 10, height: 10, borderRadius: 5 },
  // Selected-day ring (filter active)
  calDaySelectedRing: { borderWidth: 2, borderColor: '#FFFFFF' },

  // Legend
  calLegend: {
    flexDirection: 'column',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  calLegendItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  calLegendText: { fontSize: 16 },
  // Day-filter "show all" chip
  showAllChip: {
    borderWidth: 1,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    marginTop: spacing.xs,
  },
  showAllChipText: { fontSize: 14, fontWeight: '700' },

  // Muted divider between upcoming and past commitments
  pastDividerHeader: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing.md, marginBottom: spacing.sm, marginTop: spacing.lg },
  selectedDayTitle: { fontSize: 17, fontWeight: '700' },

  // Commitment cards
  commitCard: { borderRadius: borderRadius.lg, borderLeftWidth: 4, padding: spacing.md },
  commitCardInner: { flexDirection: 'row', alignItems: 'center' },
  commitDogPhotos: { flexDirection: 'row', alignItems: 'center', marginRight: 12 },
  commitDogPhoto: { width: 48, height: 48, borderRadius: 24, borderWidth: 2 },
  commitInfo: { flex: 1 },
  commitRoleLabel: { fontSize: 13, fontWeight: '700', textTransform: 'uppercase', marginBottom: 1 },
  commitDogName: { fontSize: 18, fontWeight: '700' },
  commitOther: { fontSize: 15, marginTop: 1 },
  commitDates: { fontSize: 14, marginTop: 2 },
  commitComp: { fontSize: 14, marginTop: 2, fontWeight: '600' },
  commitArrow: { fontSize: 26 },
  expandedSection: {
    borderLeftWidth: 4,
    borderTopWidth: 1,
    borderBottomLeftRadius: borderRadius.lg,
    borderBottomRightRadius: borderRadius.lg,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    paddingTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  expandedRow: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  expandedLabel: {
    fontSize: 15,
    fontWeight: '600',
    width: 100,
    paddingTop: 1,
  },
  expandedValue: {
    fontSize: 16,
    flex: 1,
  },
  expandedButtons: {
    alignItems: 'center' as const,
    marginTop: spacing.sm,
  },
  expandedBtn: {
    width: '100%' as const,
    paddingVertical: 14,
    borderRadius: borderRadius.md,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  expandedBtnText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
  deleteLink: {
    marginTop: 12,
    alignItems: 'center' as const,
  },
  deleteLinkText: {
    color: '#E74C3C',
    fontSize: 16,
    fontWeight: '600',
    textDecorationLine: 'underline' as const,
  },
});

export default RequestsScreen;
