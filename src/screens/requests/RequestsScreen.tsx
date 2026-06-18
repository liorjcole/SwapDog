/**
 * RequestsScreen (now "Schedule") — two tabs:
 *   "My Posts"     : the user's own posts so they can see responses / cancel
 *   "Commitments"  : calendar-style view of all accepted swap commitments
 *                    Red (#FF2D55) = your dog being watched; Teal (#2DD4BF) = you're watching
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
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { RequestsStackParamList } from '../../navigation/types';
import { useAuthContext } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { smartDate } from '../../utils/dateHelpers';
import { useSwaps } from '../../hooks/useSwaps';
import { SwapPost } from '../../models/types';
import { spacing, borderRadius, shadow } from '../../config/theme';
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

// ── Date helpers ──────────────────────────────────────────────────────────────
function overlapsDate(post: SwapPost, date: Date): boolean {
  const cell = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const start = new Date(post.startDate.getFullYear(), post.startDate.getMonth(), post.startDate.getDate());
  const end = new Date(post.endDate.getFullYear(), post.endDate.getMonth(), post.endDate.getDate());
  return start <= cell && cell <= end;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

// ─────────────────────────────────────────────────────────────────────────────

const RequestsScreen: React.FC<Props> = ({ navigation }) => {
  const { colors } = useTheme();
  const { user } = useAuthContext();
  const { getMyPosts, cancelPost, getAcceptedPosts, saveSitterReminderIds } = useSwaps();

  const [tab, setTab] = useState<TabType>('mine');
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
      setMyPosts(mine.filter((p: any) => p.status !== 'cancelled').sort((a: any, b: any) => {
        const aIsClaimed = a.status === 'claimed' || a.status === 'reschedulePending' ? 0 : 1;
        const bIsClaimed = b.status === 'claimed' || b.status === 'reschedulePending' ? 0 : 1;
        return aIsClaimed - bIsClaimed;
      }));
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
    if (post.totalPayment && post.paymentAmount && post.totalUnits && post.paymentRate) {
      const rateLabel = post.paymentRate === 'per_hour' ? '/hr' : '/day';
      const unitLabel =
        post.paymentRate === 'per_hour'
          ? `${post.totalUnits} hr${post.totalUnits !== 1 ? 's' : ''}`
          : `${post.totalUnits} day${post.totalUnits !== 1 ? 's' : ''}`;
      return `$${post.totalPayment} total ($${post.paymentAmount}${rateLabel} × ${unitLabel})`;
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
        accessibilityLabel={`Your post for ${item.dogName}`}
      >

        {isClaimed && (
          <View style={{ backgroundColor: '#FDCB6E', paddingVertical: 6, paddingHorizontal: 12, borderTopLeftRadius: 12, borderTopRightRadius: 12, alignItems: 'center', marginTop: -spacing.md, marginHorizontal: -spacing.md }}>
            <Text style={{ color: '#5D4E00', fontSize: 13, fontWeight: '800', letterSpacing: 0.5 }}>
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
          {item.dogPhotoURL ? (
            <Image source={{ uri: item.dogPhotoURL }} style={[styles.dogThumbSmall, { borderColor: colors.border }]} />
          ) : (
            <View style={[styles.dogThumbPlaceholder, { backgroundColor: colors.primary + '15' }]}>
              <Text style={styles.dogThumbEmoji}>D</Text>
            </View>
          )}
          <View style={styles.headerInfo}>
            <Text style={[styles.posterName, { color: isClaimed ? '#5D4E00' : colors.text }]}>{item.dogName}</Text>
            <Text style={[styles.dateRange, { color: isClaimed ? '#8B7500' : colors.textSecondary }]}>
              {startStr} – {endStr}
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
  const renderCommitmentCard = (post: SwapPost, onCardPress?: () => void) => {
    if (!onCardPress) onCardPress = () => handleCommitmentTap(post);
    const isMyDog = post.posterId === user?.uid;
    const accentColor = isMyDog ? RED : TEAL;
    const roleLabel = isMyDog ? 'Your dog' : "You're watching";
    const otherName = isMyDog
      ? (post.respondedBy?.find((r) => r.userId === post.claimedBy)?.userName ?? 'Your sitter')
      : post.posterName;
    const startStr = smartDate(post.startDate);
    const endStr = smartDate(post.endDate, { includeYear: true });

    return (
      <TouchableOpacity
        key={post.id}
        style={[
          styles.commitCard,
          { backgroundColor: colors.surface, borderLeftColor: accentColor, ...shadow.sm },
        ]}
        onPress={onCardPress}
        accessibilityRole="button"
        accessibilityLabel={`${roleLabel}: ${post.dogName} with ${otherName}`}
      >
        <View style={styles.commitCardInner}>
          <View style={styles.commitInfo}>
            <Text style={[styles.commitRoleLabel, { color: accentColor }]}>{roleLabel}</Text>
            <Text style={[styles.commitDogName, { color: colors.text }]}>{post.dogName}</Text>
            <Text style={[styles.commitOther, { color: colors.textSecondary }]}>{otherName}</Text>
            <Text style={[styles.commitDates, { color: colors.textSecondary }]}>
              {startStr} – {endStr}
            </Text>
            {post.compensationType !== 'points' && (
              <Text style={[styles.commitComp, { color: '#00B894' }]}>
                {compensationLabel(post)}
              </Text>
            )}
          </View>
          <Text style={[styles.commitArrow, { color: colors.primary }]}>›</Text>
        </View>
      </TouchableOpacity>
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
                    // Single color: red = your dog, teal = you're watching
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
                        isSelected && { fontSize: 20, fontWeight: '800' },
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
              Your dog being watched
            </Text>
          </View>
          <View style={styles.calLegendItem}>
            <View style={[styles.calDot, { backgroundColor: TEAL }]} />
            <Text style={[styles.calLegendText, { color: colors.textSecondary }]}>
              You're watching
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
    { key: 'mine', label: 'My Posts' },
    {
      key: 'commitments',
      label: `Commitments${acceptedPosts.length > 0 ? ` (${acceptedPosts.length})` : ''}`,
    },
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
              <EmptyStateView
                emoji=""
                title="No posts yet"
                subtitle="Post a request and local sitters will reach out"
              />
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
  tabText: { fontSize: 13, fontWeight: '600' },

  // My Posts list
  list: { padding: spacing.md, paddingBottom: spacing.xl * 3 },

  // Card shared
  card: { borderRadius: borderRadius.lg, padding: spacing.md, marginBottom: spacing.md },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  headerInfo: { flex: 1 },
  posterName: { fontSize: 15, fontWeight: '700' },
  dateRange: { fontSize: 12, marginTop: 1 },
  dogThumbSmall: { width: 44, height: 44, borderRadius: borderRadius.sm, borderWidth: 1 },
  dogThumbPlaceholder: {
    width: 44,
    height: 44,
    borderRadius: borderRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dogThumbEmoji: { fontSize: 20 },
  compBadge: {
    borderWidth: 1.5,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    alignSelf: 'flex-start',
    marginBottom: spacing.xs,
  },
  compBadgeText: { fontSize: 13, fontWeight: '700' },
  statusBadge: { paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: borderRadius.full },
  statusBadgeText: { fontSize: 11, fontWeight: '700' },
  cancelBtn: {
    borderWidth: 1.5,
    borderRadius: borderRadius.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    alignSelf: 'flex-start',
    marginTop: spacing.xs,
  },
  cancelBtnText: { fontSize: 13, fontWeight: '600' },
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
  interestBadgeText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  // Points — plain bold white text
  compPlainText: { fontSize: 14, fontWeight: '700', marginBottom: spacing.xs },
  // Care type row (Wave 19B)
  careTypeRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: spacing.xs },
  careTypeIcon: { fontSize: 14 },
  careTypeSummaryText: { fontSize: 12, fontWeight: '500', flex: 1 },

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
  postRequestCardText: { color: '#FFFFFF', fontSize: 16, fontWeight: '400' },

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
  calNavText: { fontSize: 28, lineHeight: 32 },
  calMonthTitle: { fontSize: 18, fontWeight: '700' },

  // Day-of-week row
  calDowRow: { flexDirection: 'row', marginBottom: spacing.xs },
  calDowText: { width: CELL_WIDTH, textAlign: 'center', fontSize: 12, fontWeight: '600' },

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
  calDayNum: { fontSize: 14, fontWeight: '500' },
  calDots: { flexDirection: 'row', gap: 2, marginTop: 1 },
  calDot: { width: 6, height: 6, borderRadius: 3 },

  // Legend
  calLegend: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.lg,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  calLegendItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  calLegendText: { fontSize: 11 },

  // Section header for all commitments list
  allCommitmentsHeader: { borderTopWidth: 1, paddingTop: spacing.md, marginBottom: spacing.sm },
  selectedDayTitle: { fontSize: 15, fontWeight: '700' },
  noneToday: { alignItems: 'center', paddingVertical: spacing.lg },
  noneTodayText: { fontSize: 14, fontStyle: 'italic' },
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
  popupDate: { fontSize: 16, fontWeight: '700', flex: 1, marginRight: spacing.sm },
  popupCloseBtn: { padding: 4 },
  popupCloseText: { fontSize: 20, fontWeight: '300' },
  popupScroll: { flexShrink: 1 },
  // Keep old selectedDayHeader alias so nothing breaks
  selectedDayHeader: { borderTopWidth: 1, paddingTop: spacing.md, marginBottom: spacing.sm },

  // Commitment cards
  commitList: { gap: spacing.sm },
  commitCard: { borderRadius: borderRadius.lg, borderLeftWidth: 4, padding: spacing.md },
  commitCardInner: { flexDirection: 'row', alignItems: 'center' },
  commitInfo: { flex: 1 },
  commitRoleLabel: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', marginBottom: 1 },
  commitDogName: { fontSize: 16, fontWeight: '700' },
  commitOther: { fontSize: 13, marginTop: 1 },
  commitDates: { fontSize: 12, marginTop: 2 },
  commitComp: { fontSize: 12, marginTop: 2, fontWeight: '600' },
  commitArrow: { fontSize: 24 },
});

export default RequestsScreen;
