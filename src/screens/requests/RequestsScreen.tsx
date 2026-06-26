/**
 * RequestsScreen (now "Schedule") — two tabs:
 *   "My Posts"     : the user's own posts so they can see responses / cancel
 *   "Commitments"  : calendar-style view of all accepted swap commitments
 *                    Red (#FF2D55) = your dog is being cared for; Teal (#2DD4BF) = you're caring for someone's dog
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
  ScrollView,
  Dimensions,
  Modal,
  PanResponder,
  Animated,
  LayoutAnimation,
  UIManager,
  Platform,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { RequestsStackParamList } from '../../navigation/types';
import { useAuthContext } from '../../contexts/AuthContext';
import { useMessaging } from '../../hooks/useMessaging';
import { sendSystemMessageToUser } from '../../hooks/useMessaging';
import { useTheme } from '../../contexts/ThemeContext';
import { smartDate, isSameDay } from '../../utils/dateHelpers';
import { useSwaps } from '../../hooks/useSwaps';
import { usePoints } from '../../hooks/usePoints';
import { usePointsHistory } from '../../hooks/usePointsHistory';
import { useReviews } from '../../hooks/useReviews';
import { SwapPost } from '../../models/types';
import { spacing, borderRadius, shadow } from '../../config/theme';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../config/firebase';
import EmptyStateView from '../../components/common/EmptyStateView';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import {
  cancelSwapReminders,
  scheduleSitterReminders,
  requestNotificationPermissions,
} from '../../services/ReminderService';

const RED = '#FF2D55';
const TEAL = '#2DD4BF';


// ── Care type helpers (Wave 19B) ──────────────────────────────────────────────
function getCareTypeIcon(careType?: string): string {
  switch (careType) {
    case 'overnight': return '🌙';
    case 'daySitting': return '☀️';
    case 'feeding': return '🍽️';
    case 'dogWalking': return '🦮';
    default: return '🐾';
  }
}

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

const SCREEN_WIDTH = Dimensions.get('window').width;
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
  const { user, userProfile } = useAuthContext();
  const { getMyPosts, cancelPost, getAcceptedPosts, saveSitterReminderIds, isPostExpired, isStartExpiredNoHelper } = useSwaps();
  const { hasReviewed } = useReviews();
  const { getOrCreateConversation } = useMessaging();
  const { deductPoints, addPoints } = usePoints();
  const { recordEntry } = usePointsHistory();

  const [tab, setTab] = useState<TabType>('commitments');
  const [expandedCommitId, setExpandedCommitId] = useState<string | null>(null);

  // Enable LayoutAnimation on Android
  if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
    UIManager.setLayoutAnimationEnabledExperimental(true);
  }
  const scrollViewRef = useRef<ScrollView>(null);
  const [flashDates, setFlashDates] = useState<{ start: Date; end: Date } | null>(null);
  const flashAnim = useRef(new Animated.Value(1)).current;
  const flashColorAnim = useRef(new Animated.Value(0)).current;

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
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Calendar state — default to current month / today selected
  const today = new Date();
  const [selectedDate, setSelectedDate] = useState<Date>(
    new Date(today.getFullYear(), today.getMonth(), today.getDate()),
  );
  const [calMonth, setCalMonth] = useState<Date>(
    new Date(today.getFullYear(), today.getMonth(), 1),
  );

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

  // Popup overlay state
  const [popupCommitments, setPopupCommitments] = useState<SwapPost[]>([]);
  const [popupDate, setPopupDate] = useState<Date | null>(null);
  const [showPopup, setShowPopup] = useState(false);

  const fetchPosts = useCallback(async () => {
    if (!user) return;
    try {
      const [mine, accepted] = await Promise.all([
        getMyPosts(user.uid),
        getAcceptedPosts(user.uid),
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
      // Sort active: claimed on top
      active.sort((a: any, b: any) => {
        const aIsClaimed = a.status === 'claimed' || a.status === 'reschedulePending' ? 0 : 1;
        const bIsClaimed = b.status === 'claimed' || b.status === 'reschedulePending' ? 0 : 1;
        return aIsClaimed - bIsClaimed;
      });
      // Sort archived: completed first, then by date
      archived.sort((a, b) => {
        if (a.status === 'completed' && b.status !== 'completed') return -1;
        if (a.status !== 'completed' && b.status === 'completed') return 1;
        return b.endDate.getTime() - a.endDate.getTime();
      });
      setMyPosts(active);
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
      setAcceptedPosts(accepted);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useFocusEffect(useCallback(() => { fetchPosts(); }, [fetchPosts]));

  // ── Sitter-side reminder scheduling ───────────────────────────────────────
  useEffect(() => {
    if (!user || acceptedPosts.length === 0) return;

    const scheduleMissingReminders = async () => {
      for (const post of acceptedPosts) {
        if (post.claimedBy !== user.uid) continue;
        if ((post.sitterReminderNotificationIds ?? []).length > 0) continue;

        const storageKey = `sitter_reminders_scheduled_${post.id}`;
        try {
          const alreadyScheduled = await AsyncStorage.getItem(storageKey);
          if (alreadyScheduled) continue;

          const hasPermission = await requestNotificationPermissions();
          if (!hasPermission) continue;

          const sitterIds = await scheduleSitterReminders({
            startDate: post.startDate,
            dogName: post.dogName,
            ownerName: post.posterName,
            sitterName: user.displayName ?? 'You',
          });

          if (sitterIds.length > 0) {
            await AsyncStorage.setItem(storageKey, 'true');
            saveSitterReminderIds(post.id, sitterIds).catch((e) =>
              console.warn('[RequestsScreen] saveSitterReminderIds failed:', e),
            );
          }
        } catch (e) {
          console.warn('[RequestsScreen] sitter reminder scheduling failed:', e);
        }
      }
    };

    scheduleMissingReminders();
  }, [acceptedPosts, user?.uid]);

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
    const isClaimed = item.status === 'claimed' || item.status === 'reschedulePending';
    const interestedCount = item.respondedBy?.length ?? 0;
    const statusColor: Record<SwapPost['status'], string> = {
      open: '#00B894',
      claimed: '#FDCB6E',
      completed: '#4ECDC4',
      cancelled: '#636E72',
      reschedulePending: '#F39C12',
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
              {item.status === 'reschedulePending' ? 'RESCHEDULE PENDING' : 'CLAIMED'}
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
              {item.status === 'reschedulePending' ? 'RESCHEDULE PENDING' : item.status.toUpperCase()}
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
                onPress={() => navigation.navigate('PostDetail', { postId: item.id })}
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

  /** Returns red/teal dot presence for a given calendar date. */
  const getDotsForDate = (date: Date): { red: boolean; teal: boolean } => {
    let red = false;
    let teal = false;
    for (const post of acceptedPosts) {
      if (!overlapsDate(post, date)) continue;
      if (post.posterId === user?.uid) red = true;
      if (post.claimedBy === user?.uid) teal = true;
    }
    return { red, teal };
  };

  const selectedCommitments = acceptedPosts.filter((p) => overlapsDate(p, selectedDate));

  // All commitments sorted chronologically (always-visible list)
  const allSortedCommitments = [...acceptedPosts].sort(
    (a, b) => a.startDate.getTime() - b.startDate.getTime(),
  );


  const handleCommitmentTap = (post: SwapPost) => {
    const targetDate = post.startDate;
    setSelectedDate(targetDate);
    
    // Navigate to commitments month if different
    const targetMonth = new Date(targetDate.getFullYear(), targetDate.getMonth(), 1);
    setCalMonth(targetMonth);
    
    // Scroll to top of calendar
    scrollViewRef.current?.scrollTo({ y: 0, animated: true });
    
    // Flash animation — triple size pulse with red flash, 3 times
    setFlashDates({ start: post.startDate, end: post.endDate });
    flashAnim.setValue(1);
    flashColorAnim.setValue(0);
    Animated.parallel([
      Animated.sequence([
        // Pulse 1
        Animated.timing(flashAnim, { toValue: 3, duration: 250, useNativeDriver: false }),
        Animated.timing(flashAnim, { toValue: 1, duration: 200, useNativeDriver: false }),
        // Pulse 2
        Animated.timing(flashAnim, { toValue: 3, duration: 250, useNativeDriver: false }),
        Animated.timing(flashAnim, { toValue: 1, duration: 200, useNativeDriver: false }),
        // Pulse 3
        Animated.timing(flashAnim, { toValue: 3, duration: 250, useNativeDriver: false }),
        Animated.timing(flashAnim, { toValue: 1, duration: 200, useNativeDriver: false }),
      ]),
      Animated.sequence([
        // Red flash 1
        Animated.timing(flashColorAnim, { toValue: 1, duration: 250, useNativeDriver: false }),
        Animated.timing(flashColorAnim, { toValue: 0, duration: 200, useNativeDriver: false }),
        // Red flash 2
        Animated.timing(flashColorAnim, { toValue: 1, duration: 250, useNativeDriver: false }),
        Animated.timing(flashColorAnim, { toValue: 0, duration: 200, useNativeDriver: false }),
        // Red flash 3
        Animated.timing(flashColorAnim, { toValue: 1, duration: 250, useNativeDriver: false }),
        Animated.timing(flashColorAnim, { toValue: 0, duration: 200, useNativeDriver: false }),
      ]),
    ]).start(() => setFlashDates(null));
  };

  // Handle calendar date tap — show popup if that date has commitments
  const handleDatePress = (date: Date) => {
    const dayCommitments = acceptedPosts.filter((p) => overlapsDate(p, date));
    setSelectedDate(new Date(date.getFullYear(), date.getMonth(), date.getDate()));
    if (dayCommitments.length > 0) {
      setPopupCommitments(dayCommitments);
      setPopupDate(date);
      setShowPopup(true);
    }
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

  const handleCancelCommitment = (post: SwapPost) => {
    const isOwner = post.posterId === user?.uid;
    const isSitter = post.claimedBy === user?.uid;
    const now = new Date();
    const startMs = post.startDate instanceof Date ? post.startDate.getTime() : new Date(post.startDate).getTime();
    const endMs = post.endDate instanceof Date ? post.endDate.getTime() : new Date(post.endDate).getTime();
    const hoursUntilStart = (startMs - now.getTime()) / (1000 * 60 * 60);
    const isLateCancel = hoursUntilStart < 24 && hoursUntilStart > 0;

    const doCancel = async () => {
      try {
        await cancelPost(post.id);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        fetchPosts();
      } catch (err) {
        console.warn('[RequestsScreen] Cancel failed:', err);
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
          
                fetchPosts();
              } catch (err) {
                console.warn('[RequestsScreen] Sitter late cancel failed:', err);
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
                  description: `Late cancellation penalty — ${post.dogName ?? 'dog'} care`,
                  points: -penaltyPoints,
                  relatedPostId: post.id,
                });

                // Give the sitter the penalty points
                await addPoints(sitterId, penaltyPoints);
                await recordEntry(sitterId, {
                  type: 'bonus',
                  description: `Late cancellation compensation — ${post.dogName ?? 'dog'} care`,
                  points: penaltyPoints,
                  relatedPostId: post.id,
                });

                await cancelPost(post.id);
                // Mark post as late-cancelled so the sitter gets review prompts
                updateDoc(doc(db, 'swapPosts', post.id), { lateCancelled: true, lateCancelledBy: 'owner', updatedAt: serverTimestamp() })
                  .catch(() => { /* non-fatal */ });
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                fetchPosts();
              } catch (err) {
                console.warn('[RequestsScreen] Late cancel penalty failed:', err);
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
  };

  const toggleExpand = (postId: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedCommitId((prev) => (prev === postId ? null : postId));
  };

  const renderCommitmentCard = (post: SwapPost, onCardPress?: () => void) => {
    const isMyDog = post.posterId === user?.uid;
    const accentColor = isMyDog ? RED : TEAL;
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
      <View key={post.id}>
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

              {post.status !== 'completed' && (
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

  // ── Commitments tab ───────────────────────────────────────────────────────
  const renderCommitmentsTab = () => {
    const calDays = buildCalendarDays();

    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        ref={scrollViewRef}
        contentContainerStyle={styles.calendarScroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              fetchPosts();
            }}
          />
        }
      >
        {/* Calendar section — entire area swipeable left/right */}
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
            const isSelected = isSameDay(date, selectedDate);
            const isToday = isSameDay(date, today);
            const hasAny = dots.red || dots.teal;

            // Commitment scheduled: filled circle (red=owner, teal=sitter)
            // Selected/clicked: bold number + dot underneath
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
                  const isFlashing = flashDates && (() => { const d = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime(); const s = new Date(flashDates.start.getFullYear(), flashDates.start.getMonth(), flashDates.start.getDate()).getTime(); const e = new Date(flashDates.end.getFullYear(), flashDates.end.getMonth(), flashDates.end.getDate()).getTime(); return d >= s && d <= e; })();
                  if (isFlashing) {
                    // Flashing: animated circle — always wins, even if selected
                    return (
                      <Animated.View style={[styles.calDayCircle, { backgroundColor: flashColorAnim.interpolate({ inputRange: [0, 1], outputRange: [commitColor ?? RED, '#FF0000'] }), overflow: 'visible' }, { transform: [{ scale: flashAnim }] }]}>
                        <Text style={[styles.calDayNum, { color: '#fff', fontWeight: '800' }]}>
                          {date.getDate()}
                        </Text>
                      </Animated.View>
                    );
                  }
                  if (hasAny) {
                    // Both red + teal on same day: split circle 50/50 vertical
                    if (dots.red && dots.teal) {
                      return (
                        <View style={[styles.calDayCircle, { overflow: 'hidden' }]}>
                          <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '50%', backgroundColor: RED }} />
                          <View style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: '50%', backgroundColor: TEAL }} />
                          <Text style={[styles.calDayNum, { color: '#fff', fontWeight: isSelected ? '800' : '700', fontSize: isSelected ? 18 : 14 }]}>
                            {date.getDate()}
                          </Text>
                        </View>
                      );
                    }
                    // Single color: red = your dog, teal = you're caring for someone's dog
                    return (
                      <View style={[styles.calDayCircle, { backgroundColor: commitColor ?? RED }]}>
                        <Text style={[styles.calDayNum, { color: '#fff', fontWeight: isSelected ? '800' : '700', fontSize: isSelected ? 18 : 14 }]}>
                          {date.getDate()}
                        </Text>
                      </View>
                    );
                  }
                  // Normal or selected (no commitment)
                  return (
                    <View style={[
                      styles.calDayCircle,
                      !isSelected && isToday
                        ? { borderWidth: 1.5, borderColor: colors.primary }
                        : undefined,
                    ]}>
                      <Text style={[
                        styles.calDayNum,
                        { color: isSelected ? colors.text : colors.text },
                        isSelected && { fontSize: 22, fontWeight: '800' },
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

        {/* Legend */}
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
        </View>

        {/* Always-visible chronological list of ALL commitments */}
        <View style={[styles.allCommitmentsHeader, { borderTopColor: colors.border }]}>
          <Text style={[styles.selectedDayTitle, { color: colors.text }]}>
            All Commitments
          </Text>
        </View>

        {allSortedCommitments.length === 0 ? (
          <View style={styles.noneToday}>
            <Text style={[styles.noneTodayText, { color: colors.textSecondary }]}>
              No upcoming commitments
            </Text>
          </View>
        ) : (
          <View style={styles.commitList}>
            {allSortedCommitments.map((post) => renderCommitmentCard(post))}
          </View>
        )}
      </ScrollView>

      {/* ── Date Tap Popup Overlay ── */}
      <Modal
        visible={showPopup}
        transparent
        animationType="fade"
        onRequestClose={() => setShowPopup(false)}
      >
        <TouchableOpacity
          style={styles.popupBackdrop}
          activeOpacity={1}
          onPress={() => setShowPopup(false)}
        >
          <View
            style={[styles.popupCard, { backgroundColor: colors.surface }]}
            onStartShouldSetResponder={() => true}
          >
            {/* Header */}
            <View style={styles.popupHeader}>
              <Text style={[styles.popupDate, { color: colors.text }]}>
                {popupDate ? smartDate(popupDate) : ''}
              </Text>
              <TouchableOpacity
                onPress={() => setShowPopup(false)}
                style={styles.popupCloseBtn}
                accessibilityLabel="Close"
                accessibilityRole="button"
              >
                <Text style={[styles.popupCloseText, { color: colors.textSecondary }]}>✕</Text>
              </TouchableOpacity>
            </View>
            {/* Scrollable commitment list */}
            <ScrollView style={styles.popupScroll} showsVerticalScrollIndicator={false}>
              {popupCommitments.map((post) => renderCommitmentCard(post, () => { setShowPopup(false); navigation.navigate('PostDetail', { postId: post.id }); }))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
      </View>
    );
  };

  // ─────────────────────────────────────────────────────────────────────────
  if (loading) return <LoadingSpinner />;

  const tabs: { key: TabType; label: string }[] = [
    {
      key: 'commitments',
      label: `Commitments${acceptedPosts.length > 0 ? ` (${acceptedPosts.length})` : ''}`,
    },
    { key: 'mine', label: 'My Posts' },
  ];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Tab bar */}
      <View style={[styles.tabs, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        {tabs.map((t) => (
          <TouchableOpacity
            key={t.key}
            style={[
              styles.tab,
              tab === t.key && { borderBottomColor: colors.primary, borderBottomWidth: 2 },
            ]}
            onPress={() => setTab(t.key)}
            accessibilityLabel={t.label}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === t.key }}
          >
            <Text
              style={[
                styles.tabText,
                { color: tab === t.key ? colors.primary : colors.textSecondary },
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
            data={myPosts}
            keyExtractor={(p) => p.id}
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
              archivedPosts.length === 0 ? (
                <EmptyStateView
                  emoji=""
                  title="No posts yet"
                  subtitle="Post a request and local sitters will reach out"
                />
              ) : null
            }
            ListFooterComponent={
              archivedPosts.length > 0 ? (
                <View style={{ marginTop: 24 }}>
                  <Text style={{ color: colors.textSecondary, fontSize: 15, fontWeight: '700', letterSpacing: 1, marginBottom: 12, paddingHorizontal: 4, textTransform: 'uppercase' }}>
                    Archive
                  </Text>
                  {archivedPosts.map((post) => (
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
        renderCommitmentsTab()
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

  // Calendar container
  calendarScroll: { padding: spacing.md, paddingBottom: spacing.xl * 3 },

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

  // Section header for all commitments list
  allCommitmentsHeader: { borderTopWidth: 1, paddingTop: spacing.md, marginBottom: spacing.sm },
  selectedDayTitle: { fontSize: 17, fontWeight: '700' },
  noneToday: { alignItems: 'center', paddingVertical: spacing.lg },
  noneTodayText: { fontSize: 16, fontStyle: 'italic' },
  // Popup overlay
  popupBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  popupCard: {
    width: '85%',
    maxHeight: '70%',
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 8,
  },
  popupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  popupDate: { fontSize: 18, fontWeight: '700', flex: 1, marginRight: spacing.sm },
  popupCloseBtn: { padding: 4 },
  popupCloseText: { fontSize: 22, fontWeight: '300' },
  popupScroll: { flexShrink: 1 },
  // Keep old selectedDayHeader alias so nothing breaks
  selectedDayHeader: { borderTopWidth: 1, paddingTop: spacing.md, marginBottom: spacing.sm },

  // Commitment cards
  commitList: { gap: spacing.sm },
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
