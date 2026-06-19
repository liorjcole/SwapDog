/**
 * PostDetailScreen — Wave 19B
 *
 * - Shows care type icon + label prominently
 * - Shows schedule info per care type
 * - Shows compensation: money OR points offered
 * - "I Can Help" flow: accept at offered pts
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Image,
  Alert,
  Modal,
  FlatList,
  Dimensions,
  NativeSyntheticEvent,
  NativeScrollEvent,
  StatusBar,
  SafeAreaView,
  TextInput,
  Platform } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import { getDoc, doc, updateDoc, serverTimestamp, addDoc, collection } from 'firebase/firestore';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { db } from '../../config/firebase';
import { RequestsStackParamList } from '../../navigation/types';
import { useAuthContext } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import ConfettiCelebration, { CelebrationItem } from '../../components/common/ConfettiCelebration';
import { smartDate } from '../../utils/dateHelpers';
import { useSwaps } from '../../hooks/useSwaps';
import { useUsers } from '../../hooks/useUsers';
import { useMessaging } from '../../hooks/useMessaging';
import { SwapPost } from '../../models/types';
import { spacing, borderRadius, shadow, typography } from '../../config/theme';
import LoadingSpinner from '../../components/common/LoadingSpinner';
import { scheduleOwnerReminders, requestNotificationPermissions } from '../../services/ReminderService';

const RED = '#FF2D55';
const GREEN = '#00B894';
const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CAROUSEL_HEIGHT = Math.round(Dimensions.get('window').height * 0.4);

type Props = {
  navigation: NativeStackNavigationProp<RequestsStackParamList, 'PostDetail'>;
  route: RouteProp<RequestsStackParamList, 'PostDetail'>;
};

// ─── Care Type Helpers ────────────────────────────────────────────────────────

/** Map dogIds to display names using post.dogIds/dogNames arrays */
function resolveDogNames(dogIds: string[], post: SwapPost): string {
  if (!dogIds.length || !post.dogIds || !post.dogNames) return '';
  const names = dogIds.map(id => {
    const idx = post.dogIds!.indexOf(id);
    return idx >= 0 ? post.dogNames![idx] : '';
  }).filter(Boolean);
  return names.join(', ');
}

function getCareTypeIcon(careType?: string): string {
  switch (careType) {
    case 'overnight': return 'Overnight sitting';
    case 'daySitting': return 'Daytime sitting';
    case 'feeding': return 'Feeding';
    case 'dogWalking': return 'Walk';
    default: return '';
  }
}

function getCareTypeLabel(careType?: string): string {
  switch (careType) {
    case 'overnight': return 'Overnight sitting';
    case 'daySitting': return 'Daytime sitting';
    case 'feeding': return 'Feeding';
    case 'dogWalking': return 'Walk';
    default: return 'Pet Care';
  }
}

function getScheduleInfo(post: SwapPost): string {
  const startStr = smartDate(post.startDate);
  const endStr = smartDate(post.endDate, { includeYear: true });

  switch (post.careType) {
    case 'overnight': {
      const MS_PER_DAY = 1000 * 60 * 60 * 24;
      const nights = Math.max(1, Math.round((post.endDate.getTime() - post.startDate.getTime()) / MS_PER_DAY));
      return `${startStr} → ${endStr} (${nights} night${nights !== 1 ? 's' : ''})`;
    }
    case 'daySitting': {
      const timeInfo = post.startTime && post.endTime
        ? `, ${post.startTime} → ${post.endTime}`
        : '';
      return `${startStr}${timeInfo}`;
    }
    case 'feeding': {
      const timeInfo = post.feedingTime ? ` at ${post.feedingTime}` : '';
      return `${startStr}${timeInfo}`;
    }
    case 'dogWalking': {
      if (post.walkDurationMinutes) {
        const hrs = Math.floor(post.walkDurationMinutes / 60);
        const mins = post.walkDurationMinutes % 60;
        const label = hrs > 0
          ? `${hrs} hr${hrs !== 1 ? 's' : ''}${mins > 0 ? ` ${mins} min` : ''}`
          : `${mins} min`;
        return ` ${label} walk`;
      }
      return ' Dog Walking';
    }
    default:
      return `${startStr} – ${endStr}`;
  }
}

// ─── Photo Carousel ───────────────────────────────────────────────────────────

interface PhotoCarouselProps {
  photos: string[];
  onPhotoPress: (index: number) => void;
}

const PhotoCarouselSection: React.FC<PhotoCarouselProps> = ({ photos, onPhotoPress }) => {
  const [activeIndex, setActiveIndex] = useState(0);

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const idx = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
    setActiveIndex(idx);
  };

  if (photos.length === 0) {
    return (
      <View style={carouselStyles.placeholder}>
        <Text style={carouselStyles.placeholderEmoji}></Text>
        <Text style={carouselStyles.placeholderText}>No Photos</Text>
      </View>
    );
  }

  return (
    <View style={carouselStyles.container}>
      <FlatList
        data={photos}
        keyExtractor={(_, i) => String(i)}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={handleScroll}
        renderItem={({ item, index }) => (
          <TouchableOpacity
            activeOpacity={0.92}
            onPress={() => onPhotoPress(index)}
            style={carouselStyles.slide}
          >
            <Image source={{ uri: item }} style={carouselStyles.image} resizeMode="cover" />
          </TouchableOpacity>
        )}
      />
      {photos.length > 1 && (
        <View style={carouselStyles.dotsRow}>
          {photos.map((_, i) => (
            <View
              key={i}
              style={[carouselStyles.dot, i === activeIndex ? carouselStyles.dotActive : carouselStyles.dotInactive]}
            />
          ))}
        </View>
      )}
    </View>
  );
};

// ─── Full-screen Photo Modal ──────────────────────────────────────────────────

interface FullscreenModalProps {
  photos: string[];
  initialIndex: number;
  visible: boolean;
  onClose: () => void;
}

const FullscreenPhotoModal: React.FC<FullscreenModalProps> = ({ photos, initialIndex, visible, onClose }) => {
  const flatRef = useRef<FlatList<string>>(null);
  const [activeIndex, setActiveIndex] = useState(initialIndex);

  useEffect(() => {
    if (visible && flatRef.current && photos.length > 1) {
      const timer = setTimeout(() => {
        flatRef.current?.scrollToIndex({ index: initialIndex, animated: false });
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [visible, initialIndex, photos.length]);

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const idx = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
    setActiveIndex(idx);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <StatusBar barStyle="light-content" backgroundColor="rgba(0,0,0,0.95)" />
      <View style={modalStyles.overlay}>
        <SafeAreaView style={modalStyles.safeTop} pointerEvents="box-none">
          <TouchableOpacity style={modalStyles.closeBtn} onPress={onClose} accessibilityLabel="Close photo" accessibilityRole="button">
            <Text style={modalStyles.closeBtnText}>✕</Text>
          </TouchableOpacity>
        </SafeAreaView>
        <FlatList
          ref={flatRef}
          data={photos}
          keyExtractor={(_, i) => String(i)}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={handleScroll}
          getItemLayout={(_, index) => ({ length: SCREEN_WIDTH, offset: SCREEN_WIDTH * index, index })}
          renderItem={({ item }) => (
            <View style={modalStyles.slide}>
              <Image source={{ uri: item }} style={modalStyles.image} resizeMode="contain" />
            </View>
          )}
        />
        {photos.length > 1 && (
          <SafeAreaView style={modalStyles.safeBottom} pointerEvents="none">
            <View style={modalStyles.dotsRow}>
              {photos.map((_, i) => (
                <View key={i} style={[modalStyles.dot, i === activeIndex ? modalStyles.dotActive : modalStyles.dotInactive]} />
              ))}
            </View>
          </SafeAreaView>
        )}
      </View>
    </Modal>
  );
};

// ─── Main Screen ──────────────────────────────────────────────────────────────

const PostDetailScreen: React.FC<Props> = ({ navigation, route }) => {
  const { colors } = useTheme();
  const { user, userProfile } = useAuthContext();
  const { getAreaPosts, getMyPosts, addResponder, approveHelper, saveOwnerReminderIds, cancelPost } = useSwaps();
  const { getOrCreateConversation, sendMessage } = useMessaging();

  const [post, setPost] = useState<SwapPost | null>(null);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [isJustApproved, setIsJustApproved] = useState(false);
  const [celebrationQueue, setCelebrationQueue] = useState<CelebrationItem[]>([]);

  // Photo carousel state
  const [allPhotos, setAllPhotos] = useState<string[]>([]);
  // Reschedule/cancel state
  const [showRescheduleModal, setShowRescheduleModal] = useState(false);
  const [rescheduleStart, setRescheduleStart] = useState<Date>(new Date());
  const [rescheduleEnd, setRescheduleEnd] = useState<Date>(new Date());
  const [rescheduleNote, setRescheduleNote] = useState('');
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [modalInitialIndex, setModalInitialIndex] = useState(0);

  // "I Can Help" modal state (for points posts)
  const [helpModalVisible, setHelpModalVisible] = useState(false);

  const postId = route.params?.postId;

  const buildPhotos = async (p: SwapPost): Promise<string[]> => {
    if (p.dogPhotoURLs && p.dogPhotoURLs.length > 0) return p.dogPhotoURLs;
    if (p.dogId) {
      try {
        const dogSnap = await getDoc(doc(db, 'dogs', p.dogId));
        if (dogSnap.exists()) {
          const dogData = dogSnap.data() as { photoURLs?: string[] };
          if (dogData.photoURLs && dogData.photoURLs.length > 0) return dogData.photoURLs;
        }
      } catch { /* non-fatal */ }
    }
    if (p.dogIds && p.dogIds.length > 0) {
      try {
        const dogSnap = await getDoc(doc(db, 'dogs', p.dogIds[0]));
        if (dogSnap.exists()) {
          const dogData = dogSnap.data() as { photoURLs?: string[] };
          if (dogData.photoURLs && dogData.photoURLs.length > 0) return dogData.photoURLs;
        }
      } catch { /* non-fatal */ }
    }
    if (p.dogPhotoURL) return [p.dogPhotoURL];
    return [];
  };

  useEffect(() => {
    if (!postId) { setLoading(false); return; }
    const fetchPost = async () => {
      try {
        const areaPosts = await getAreaPosts();
        const found = areaPosts.find((p) => p.id === postId) ?? null;
        if (found) {
          setPost(found);
          setAllPhotos(await buildPhotos(found));
          return;
        }
        if (user?.uid) {
          const myPosts = await getMyPosts(user.uid);
          const ownPost = myPosts.find((p) => p.id === postId) ?? null;
          setPost(ownPost);
          if (ownPost) setAllPhotos(await buildPhotos(ownPost));
        }
      } finally {
        setLoading(false);
      }
    };
    fetchPost();
  }, [postId, user?.uid]);

  const handlePhotoPress = (index: number) => {
    setModalInitialIndex(index);
    setModalVisible(true);
  };

  // ── "I Can Help" flow ─────────────────────────────────────────────────────

  const handleHelpButtonPress = () => {
    if (!user || !post) return;
    if (user.uid === post.posterId) {
      Alert.alert("That's your post!", "You can't respond to your own request.");
      return;
    }
    if (post.compensationType === 'points') {
      setHelpModalVisible(true);
    } else {
      handleHelp();
    }
  };

  /** Accept at offered points */
  const handleAcceptPost = async () => {
    if (!user || !post) return;
    setClaiming(true);
    try {
      const sitterName = userProfile?.displayName ?? user.displayName ?? 'Someone';
      const sitterPhoto = userProfile?.photoURL ?? user.photoURL ?? undefined;
      const startStr = smartDate(post.startDate);
      const endStr = smartDate(post.endDate, { includeYear: true });
      const dogDisplayName = post.dogNames && post.dogNames.length > 1
        ? post.dogNames.join(' & ') : post.dogName;

      const convId = await getOrCreateConversation(user.uid, post.posterId, post.id);
      const introText = `Hey! I'd love to help with ${dogDisplayName} from ${startStr} to ${endStr}. I'll take the job for the offered ${post.pointsOffered ?? post.pointsCost ?? 0} points!`;
      await sendMessage(convId, user.uid, introText);

      await addResponder(post.id, { userId: user.uid, userName: sitterName, userPhotoURL: sitterPhoto });

      setHelpModalVisible(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      navigation.navigate('Chat' as any, { conversationId: convId, otherUserId: post.posterId });
    } catch (err: unknown) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Failed to respond');
    } finally {
      setClaiming(false);
    }
  };

  const handleHelp = async () => {
    if (!user || !post) return;
    setClaiming(true);
    try {
      const sitterName = userProfile?.displayName ?? user.displayName ?? 'Someone';
      const sitterPhoto = userProfile?.photoURL ?? user.photoURL ?? undefined;
      const startStr = smartDate(post.startDate);
      const endStr = smartDate(post.endDate, { includeYear: true });
      const dogDisplayName = post.dogNames && post.dogNames.length > 1
        ? post.dogNames.join(' & ') : post.dogName;

      const convId = await getOrCreateConversation(user.uid, post.posterId, post.id);
      const introText = `Hey! I'd love to help watch ${dogDisplayName} from ${startStr} to ${endStr}. Let me know if you'd like to set something up!`;
      await sendMessage(convId, user.uid, introText);

      if (post.compensationType === 'payment' || post.compensationType === 'either') {
        await sendMessage(convId, user.uid, 'Reminder: All payments are arranged and made outside of WatchDog.');
      }

      await addResponder(post.id, { userId: user.uid, userName: sitterName, userPhotoURL: sitterPhoto });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      navigation.navigate('Chat' as any, { conversationId: convId, otherUserId: post.posterId });
    } catch (err: unknown) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Failed to send message');
    } finally {
      setClaiming(false);
    }
  };

  const handleMessageResponder = async (responderId: string) => {
    if (!user || !post) return;
    setClaiming(true);
    try {
      const convId = await getOrCreateConversation(user.uid, responderId, post.id);
      navigation.navigate('Chat' as any, { conversationId: convId, otherUserId: responderId });
    } catch (err: unknown) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Could not open chat');
    } finally {
      setClaiming(false);
    }
  };

  const handleApprove = async (helperId: string, helperName: string) => {
    if (!user || !post) return;
    Alert.alert('Approve Helper', `Choose ${helperName} as your dog sitter for this post?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Approve',
        onPress: async () => {
          setApprovingId(helperId);
          try {
            await approveHelper(post.id, helperId);
            setIsJustApproved(true);
            setCelebrationQueue([{ title: 'Booking Confirmed!', subtitle: helperName + ' is now your sitter for ' + (post.dogNames && post.dogNames.length > 1 ? post.dogNames.join(' & ') : post.dogName) + '!', emoji: '🐶' }]);
            setPost((prev) => prev ? { ...prev, status: 'claimed', claimedBy: helperId } : prev);
            try {
              const hasPermission = await requestNotificationPermissions();
              if (hasPermission) {
                const dogDisplayName = post.dogNames && post.dogNames.length > 1
                  ? post.dogNames.join(' & ') : post.dogName;
                const ownerIds = await scheduleOwnerReminders({
                  startDate: post.startDate,
                  dogName: dogDisplayName,
                  ownerName: post.posterName,
                  sitterName: helperName });
                if (ownerIds.length > 0) await saveOwnerReminderIds(post.id, ownerIds);
              }
            } catch (reminderErr) {
              console.warn('[PostDetail] Failed to schedule reminders:', reminderErr);
            }
          } catch (err: unknown) {
            Alert.alert('Error', err instanceof Error ? err.message : 'Could not approve helper');
          } finally {
            setApprovingId(null);
          }
        } },
    ]);
  };



  // ── Reschedule: propose new dates to sitter ──────────────────────────────
  const handleReschedule = async () => {
    if (!post || !user) return;

    // ── Date validation ──
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    if (rescheduleStart < todayStart) {
      Alert.alert('Invalid dates', 'Start date cannot be in the past.');
      return;
    }
    if (rescheduleEnd <= rescheduleStart) {
      Alert.alert('Invalid dates', 'End date must be after the start date.');
      return;
    }

    try {
      const sitterId = post.claimedBy;
      if (!sitterId) {
        Alert.alert('Error', 'No sitter assigned to this booking.');
        return;
      }
      // Save proposed dates separately (don't overwrite original startDate/endDate)
      await updateDoc(doc(db, 'swapPosts', post.id), {
        rescheduleProposedStart: rescheduleStart,
        rescheduleProposedEnd: rescheduleEnd,
        rescheduleNote: rescheduleNote.trim() || null,
        rescheduleProposedBy: user.uid,
        status: 'reschedulePending',
        updatedAt: serverTimestamp() });
      // Send a typed reschedule message so the chat can render "Review Reschedule" link
      const convId = await getOrCreateConversation(user.uid, sitterId, post.id);
      const startStr = smartDate(rescheduleStart);
      const endStr = smartDate(rescheduleEnd);
      const note = rescheduleNote.trim() ? `\n\nNote: ${rescheduleNote.trim()}` : '';
      const msgText = `I need to reschedule. Would ${startStr} \u2013 ${endStr} work instead?${note}`;
      await addDoc(collection(db, 'conversations', convId, 'messages'), {
        conversationId: convId,
        senderId: user.uid,
        text: msgText,
        read: false,
        createdAt: serverTimestamp(),
        type: 'reschedule',
        metadata: {
          postId: post.id,
          proposedStart: rescheduleStart.toISOString(),
          proposedEnd: rescheduleEnd.toISOString() } });
      await updateDoc(doc(db, 'conversations', convId), {
        lastMessage: msgText,
        lastMessageAt: serverTimestamp(),
        updatedAt: serverTimestamp() });
      setShowRescheduleModal(false);
      setRescheduleNote('');
      setPost((prev) => prev ? { ...prev, status: 'reschedulePending' as any, rescheduleProposedStart: rescheduleStart, rescheduleProposedEnd: rescheduleEnd, rescheduleProposedBy: user.uid } : prev);
      Alert.alert('Sent', 'Your reschedule request has been sent to the sitter.');
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Could not send reschedule request');
    }
  };

  // ── Cancel a claimed booking ─────────────────────────────────────────────
  const handleCancelClaimed = () => {
    if (!post || !user) return;
    Alert.alert(
      'Cancel Booking',
      'Are you sure you want to cancel this booking? The sitter will be notified.',
      [
        { text: 'Keep Booking', style: 'cancel' },
        {
          text: 'Cancel Booking',
          style: 'destructive',
          onPress: async () => {
            try {
              const sitterId = post.claimedBy;
              await cancelPost(post.id);
              if (sitterId) {
                const convId = await getOrCreateConversation(user.uid, sitterId, post.id);
                await sendMessage(convId, user.uid, 'I had to cancel this booking. Sorry for the inconvenience!');
              }
              setPost((prev) => prev ? { ...prev, status: 'cancelled' } : prev);
              Alert.alert('Cancelled', 'The booking has been cancelled and the sitter has been notified.');
            } catch (err) {
              Alert.alert('Error', err instanceof Error ? err.message : 'Could not cancel booking');
            }
          } },
      ]
    );
  };

  // ── Loading / Not Found ────────────────────────────────────────────────────

  if (loading) return <LoadingSpinner />;
  if (!post) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={[styles.notFound, { color: colors.textSecondary }]}>Post not found</Text>
      </View>
    );
  }

  const isOwner = user?.uid === post.posterId;
  const respondents = post.respondedBy ?? [];
  const dogDisplayName = post.dogNames && post.dogNames.length > 1
    ? post.dogNames.join(' & ') : post.dogName;
  const dogDisplayBreed = post.dogBreeds && post.dogBreeds.length > 1
    ? post.dogBreeds.join(', ') : post.dogBreed;

  const compensationLabel = () => {
    if (post.compensationType === 'points') {
      const pts = post.pointsOffered ?? post.pointsCost;
      return `${pts} point${pts !== 1 ? 's' : ''} offered`;
    }
    if (post.totalPayment && post.paymentAmount && post.paymentRate) {
      const rateLabel = post.paymentRate === 'per_hour' ? '/hr' : '/day';
      if (post.careType === 'feeding') return `$${post.paymentAmount} per visit`;
      const unitLabel = post.paymentRate === 'per_hour'
        ? `${post.totalUnits} hr${post.totalUnits !== 1 ? 's' : ''}`
        : `${post.totalUnits} day${post.totalUnits !== 1 ? 's' : ''}`;
      return `$${post.totalPayment} total ($${post.paymentAmount}${rateLabel} × ${unitLabel})`;
    }
    return post.compensationType === 'either'
      ? `${(post.pointsCost ?? 0).toFixed(1)} pts or payment`
      : 'Payment offered';
  };

  const offeredPoints = post.pointsOffered ?? post.pointsCost ?? 0;

  return (
    <>
      {/* ── "I Can Help" Modal (for points posts) ── */}
      <Modal
        visible={helpModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setHelpModalVisible(false)}
      >
        <View style={{ flex: 1, backgroundColor: colors.background }}>
          <TouchableOpacity
            style={StyleSheet.absoluteFillObject}
            activeOpacity={1}
            onPress={() => setHelpModalVisible(false)}
          />
          <View style={[styles.helpModalCard, { backgroundColor: colors.surface }]}>
            <Text style={[styles.helpModalTitle, { color: colors.text }]}>
              Respond to this post
            </Text>
            <Text style={[styles.helpModalSubtitle, { color: colors.textSecondary }]}>
              This post is worth{' '}
              <Text style={{ color: RED, fontWeight: '700' }}>{offeredPoints} points</Text>
            </Text>

            <TouchableOpacity
                  style={[styles.helpModalAcceptBtn, { backgroundColor: GREEN }]}
                  onPress={handleAcceptPost}
                  disabled={claiming}
                >
                  <Text style={styles.helpModalBtnText}>
                    {claiming ? 'Sending...' : `Accept for ${offeredPoints} points`}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity onPress={() => setHelpModalVisible(false)} style={styles.helpModalCancelLink}>
                  <Text style={[styles.helpModalCancelText, { color: colors.textSecondary }]}>Cancel</Text>
                </TouchableOpacity>
          </View>
        </View>
      </Modal>


        {/* ── Confetti Celebration ── */}
      <ConfettiCelebration
        queue={celebrationQueue}
        onDismissAll={() => setCelebrationQueue([])}
      />

      {/* ── Reschedule Modal ── */}
        <Modal visible={showRescheduleModal} transparent animationType="slide">
          <View style={{ flex: 1, backgroundColor: colors.background }}>
            <SafeAreaView style={{ flex: 1 }}>
              <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled">
                <Text style={{ color: colors.text, fontSize: 22, fontWeight: '800', marginBottom: 20 }}>Propose New Dates</Text>

                <Text style={{ color: colors.textSecondary, fontSize: 13, fontWeight: '600', marginBottom: 6 }}>Start Date</Text>
                <TouchableOpacity
                  onPress={() => { setShowStartPicker(!showStartPicker); setShowEndPicker(false); }}
                  style={{ backgroundColor: colors.surface, borderRadius: 10, padding: 14, marginBottom: 4 }}
                >
                  <Text style={{ color: showStartPicker ? colors.primary : colors.text, fontSize: 16, fontWeight: '600' }}>
                    {rescheduleStart.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                  </Text>
                </TouchableOpacity>
                {showStartPicker && (
                  <DateTimePicker
                    value={rescheduleStart}
                    mode="date"
                    display={Platform.OS === 'ios' ? 'inline' : 'default'}
                    minimumDate={new Date()}
                    onChange={(_: DateTimePickerEvent, d?: Date) => {
                      if (Platform.OS !== 'ios') setShowStartPicker(false);
                      if (d) {
                        setRescheduleStart(d);
                        if (d >= rescheduleEnd) {
                          const newEnd = new Date(d);
                          newEnd.setDate(newEnd.getDate() + 1);
                          setRescheduleEnd(newEnd);
                        }
                      }
                    }}
                  />
                )}

                <Text style={{ color: colors.textSecondary, fontSize: 13, fontWeight: '600', marginTop: 16, marginBottom: 6 }}>End Date</Text>
                <TouchableOpacity
                  onPress={() => { setShowEndPicker(!showEndPicker); setShowStartPicker(false); }}
                  style={{ backgroundColor: colors.surface, borderRadius: 10, padding: 14, marginBottom: 4 }}
                >
                  <Text style={{ color: showEndPicker ? colors.primary : colors.text, fontSize: 16, fontWeight: '600' }}>
                    {rescheduleEnd.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                  </Text>
                </TouchableOpacity>
                {showEndPicker && (
                  <DateTimePicker
                    value={rescheduleEnd}
                    mode="date"
                    display={Platform.OS === 'ios' ? 'inline' : 'default'}
                    minimumDate={rescheduleStart}
                    onChange={(_: DateTimePickerEvent, d?: Date) => {
                      if (Platform.OS !== 'ios') setShowEndPicker(false);
                      if (d) setRescheduleEnd(d);
                    }}
                  />
                )}

                <Text style={{ color: colors.textSecondary, fontSize: 13, fontWeight: '600', marginTop: 16, marginBottom: 6 }}>Note (optional)</Text>
                <TextInput
                  style={{ backgroundColor: colors.surface, borderRadius: 10, padding: 14, color: colors.text, fontSize: 15, minHeight: 60, textAlignVertical: 'top', marginBottom: 20 }}
                  placeholder="e.g. Something came up, would these dates work?"
                  placeholderTextColor={colors.textSecondary}
                  value={rescheduleNote}
                  onChangeText={setRescheduleNote}
                  multiline
                  returnKeyType="done"
                  blurOnSubmit={true}
                />

                <TouchableOpacity
                  style={{ backgroundColor: '#FFD700', borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginBottom: 8 }}
                  onPress={() => { setShowStartPicker(false); setShowEndPicker(false); handleReschedule(); }}
                >
                  <Text style={{ color: '#3D2E00', fontWeight: '700', fontSize: 16 }}>Send Proposal</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={{ paddingVertical: 12, alignItems: 'center' }}
                  onPress={() => { setShowStartPicker(false); setShowEndPicker(false); setShowRescheduleModal(false); }}
                >
                  <Text style={{ color: colors.textSecondary, fontSize: 15 }}>Cancel</Text>
                </TouchableOpacity>
              </ScrollView>
            </SafeAreaView>
          </View>
        </Modal>

      <FullscreenPhotoModal
        photos={allPhotos}
        initialIndex={modalInitialIndex}
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
      />

      <ScrollView
        automaticallyAdjustKeyboardInsets={true}
        style={[styles.container, { backgroundColor: colors.background }]}
        contentContainerStyle={styles.content}
      >
        {/* ── Photo Carousel (swipeable, all dog photos) ── */}
        <PhotoCarouselSection photos={allPhotos} onPhotoPress={handlePhotoPress} />

        {/* ── Status Badge (top of post) ── */}
        <View style={{ alignItems: 'flex-start', paddingHorizontal: spacing.md, paddingTop: spacing.sm }}>
          <View style={[styles.statusBadge, { backgroundColor: post.status === 'open' ? '#00B89420' : post.status === 'reschedulePending' ? '#F39C1225' : '#63727220' }]}>
            <Text style={[styles.statusBadgeText, { color: post.status === 'open' ? '#00B894' : post.status === 'reschedulePending' ? '#F39C12' : '#636E72' }]}>
              {post.status === 'reschedulePending' ? 'RESCHEDULE PENDING' : post.status.toUpperCase()}
            </Text>
          </View>
        </View>

        {/* ── Reschedule / Cancel banner (owner, claimed post) ── */}
        {isOwner && post.status === 'claimed' && !isJustApproved && (
          <View style={[styles.rescheduleBanner, { backgroundColor: '#3D2E00', borderColor: '#FFD700' }]}>
            <Text style={{ color: '#FFD700', fontSize: 15, fontWeight: '600', marginBottom: 8 }}>
              Plans changed?
            </Text>
            <Text style={{ color: '#FFD700', fontSize: 13, marginBottom: 12 }}>
              Reschedule or cancel this booking
            </Text>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <TouchableOpacity
                style={{ flex: 1, backgroundColor: '#FFD700', borderRadius: 8, paddingVertical: 10, alignItems: 'center' }}
                onPress={() => setShowRescheduleModal(true)}
              >
                <Text style={{ color: '#3D2E00', fontWeight: '700', fontSize: 14 }}>Reschedule</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex: 1, backgroundColor: 'transparent', borderWidth: 1.5, borderColor: '#FF4444', borderRadius: 8, paddingVertical: 10, alignItems: 'center' }}
                onPress={handleCancelClaimed}
              >
                <Text style={{ color: '#FF4444', fontWeight: '700', fontSize: 14 }}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ── Interested Helpers (owner only) ── */}
        {isOwner && respondents.length > 0 && (
          <View style={styles.helpersSection}>
            <View style={styles.helpersSectionHeader}>
              <Text style={styles.helpersSectionTitle}>
                Interested Helpers ({respondents.length})
              </Text>
              {post.status === 'claimed' && (
                <View style={styles.claimedBadge}>
                  <Text style={styles.claimedBadgeText}>APPROVED</Text>
                </View>
              )}
            </View>

            {respondents.map((r) => {
              const isApproved = post.claimedBy === r.userId;
              const isApproving = approvingId === r.userId;


              return (
                <View key={r.userId} style={styles.helperRow}>
                  <TouchableOpacity
                    onPress={() => navigation.navigate('UserDetail', { userId: r.userId })}
                    accessibilityRole="button"
                    accessibilityLabel={`View ${r.userName}'s profile`}
                    style={styles.helperAvatarTouchable}
                  >
                    {r.userPhotoURL ? (
                      <Image source={{ uri: r.userPhotoURL }} style={styles.helperAvatar} />
                    ) : (
                      <View style={styles.helperAvatarPlaceholder}>
                        <Text style={styles.helperAvatarEmoji}></Text>
                      </View>
                    )}
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.helperInfo}
                    onPress={() => navigation.navigate('UserDetail', { userId: r.userId })}
                    accessibilityLabel={`View ${r.userName}'s profile`}
                  >
                    <Text style={styles.helperName}>{r.userName}</Text>

                    {isApproved ? (
                      <Text style={styles.helperApprovedLabel}>Approved sitter</Text>
                    ) : (
                      <Text style={styles.helperAcceptedPts}>
                        Interested · {offeredPoints} pts
                      </Text>
                    )}
                  </TouchableOpacity>

                  <View style={styles.helperActions}>
                    {post.status === 'open' && !isApproved && (
                      <TouchableOpacity
                        style={[styles.approveBtn, isApproving && styles.approveBtnDisabled]}
                        onPress={() => handleApprove(r.userId, r.userName)}
                        disabled={isApproving}
                        accessibilityRole="button"
                        accessibilityLabel={`Approve ${r.userName}`}
                      >
                        <Text style={styles.approveBtnText}>{isApproving ? '…' : 'Approve'}</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        )}


        {/* ── Owner (clickable → full profile) ── */}
        <View style={[styles.section, { backgroundColor: colors.surface, ...shadow.sm }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Owner</Text>
          <TouchableOpacity
            onPress={() => navigation.navigate('UserDetail', { userId: post.posterId })}
            accessibilityLabel={`View ${post.posterName}'s profile`}
            accessibilityRole="button"
            style={styles.posterRow}
          >
            {post.posterPhotoURL ? (
              <Image source={{ uri: post.posterPhotoURL }} style={[styles.posterAvatar, { borderColor: colors.border }]} />
            ) : (
              <View style={[styles.posterAvatarPlaceholder, { backgroundColor: colors.primary + '22', borderColor: colors.border }]}>
                <Text style={styles.posterAvatarEmoji}></Text>
              </View>
            )}
            <View style={styles.posterInfo}>
              <Text style={[styles.posterName, { color: colors.text }]}>{post.posterName}</Text>
              <Text style={[styles.postedAt, { color: colors.textSecondary }]}>
                Posted {smartDate(post.createdAt)}
              </Text>
            </View>
            <View style={{ width: 32, height: 32, borderRadius: 16, borderWidth: 1.5, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: colors.primary, fontSize: 18, fontWeight: '600', marginLeft: 1 }}>›</Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* ── Dogs (each clickable → DogDetail) ── */}
        <View style={[styles.section, { backgroundColor: colors.surface, ...shadow.sm }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>{post.dogIds && post.dogIds.length > 1 ? 'Pups' : 'Pup'}</Text>
          {(post.dogIds && post.dogIds.length > 0 ? post.dogIds : [post.dogId]).filter(Boolean).map((dId, idx) => {
            const dName = post.dogNames?.[idx] ?? post.dogName ?? 'Dog';
            const dBreed = post.dogBreeds?.[idx] ?? post.dogBreed ?? '';
            const dPhoto = allPhotos[idx] ?? null;
            return (
              <TouchableOpacity
                key={dId ?? idx}
                onPress={() => { if (dId) navigation.navigate('DogDetail', { dogId: dId }); }}
                accessibilityLabel={`View ${dName}'s profile`}
                accessibilityRole="button"
                style={[styles.dogRow, idx > 0 && { marginTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: spacing.sm }]}
              >
                {dPhoto ? (
                  <Image source={{ uri: dPhoto }} style={[styles.dogThumb, { borderColor: colors.border }]} />
                ) : (
                  <View style={[styles.dogThumbPlaceholder, { backgroundColor: colors.primary + '22' }]}>
                    <Text style={styles.dogThumbEmoji}>D</Text>
                  </View>
                )}
                <View style={styles.dogInfo}>
                  <Text style={[styles.dogName, { color: colors.text }]}>{dName}</Text>
                  {dBreed ? <Text style={[styles.dogBreed, { color: colors.textSecondary }]}>{dBreed}</Text> : null}
                </View>
                <View style={{ width: 32, height: 32, borderRadius: 16, borderWidth: 1.5, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: colors.primary, fontSize: 18, fontWeight: '600', marginLeft: 1 }}>›</Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* ── Care Details (full breakdown) ── */}
        <View style={[styles.section, { backgroundColor: colors.surface, ...shadow.sm }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Care Details</Text>

          {/* Primary care type + dates */}
          {post.careType && (
            <Text style={[styles.careDetailLine, { color: colors.text }]}>
              {getCareTypeIcon(post.careType)}  {getCareTypeLabel(post.careType)}
            </Text>
          )}
          <Text style={[styles.careDetailLine, { color: colors.textSecondary, fontWeight: '400', fontSize: 14 }]}>
            📅  {smartDate(post.startDate)} – {smartDate(post.endDate, { includeYear: true })}
          </Text>

          {/* Dogs */}
          {post.dogNames && post.dogNames.length > 0 && (
            <Text style={[styles.careDetailLine, { color: colors.textSecondary, fontWeight: '400', fontSize: 14, marginTop: 4 }]}>
              🐕  {post.dogNames.join(', ')}
            </Text>
          )}

          {/* Day sitting / overnight times */}
          {(post.careType === 'daySitting' || post.careType === 'overnight') && post.startTime && post.endTime && (
            <Text style={[styles.careDetailLine, { color: colors.textSecondary, fontWeight: '400', fontSize: 14, marginTop: 4 }]}>
              🕐  {post.startTime} – {post.endTime}
            </Text>
          )}

          {/* ── Add-on care breakdown ── */}
          {post.addOnCareTypes && post.addOnCareTypes.length > 0 && (
            <View style={{ marginTop: 12, borderTopWidth: 0.5, borderTopColor: colors.border, paddingTop: 12 }}>
              <Text style={{ fontSize: 14, fontWeight: '700', color: colors.text, marginBottom: 8 }}>Requested Care</Text>

              {/* Feeding slots */}
              {post.feedingSlots && post.feedingSlots.length > 0 && (
                <View style={{ marginBottom: 10 }}>
                  <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 4 }}>🍽️ Feeding</Text>
                  {post.feedingSlots.map((slot, i) => (
                    <View key={i} style={{ marginLeft: 12, marginBottom: 2 }}>
                      <Text style={{ fontSize: 13, color: colors.textSecondary }}>
                        {slot.time}{slot.daily ? '  (repeats daily)' : ''}
                        {slot.dogIds.length > 0 && post.dogNames && post.dogNames.length > 1
                          ? `  ·  ${resolveDogNames(slot.dogIds, post)}`
                          : ''}
                      </Text>
                    </View>
                  ))}
                </View>
              )}

              {/* Walk sessions */}
              {post.walkSessions && post.walkSessions.length > 0 && (
                <View style={{ marginBottom: 10 }}>
                  <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 4 }}>🐕 Walks</Text>
                  {post.walkSessions.map((ws, i) => {
                    const durLabel = ws.durationMins >= 60
                      ? `${Math.floor(ws.durationMins / 60)}h${ws.durationMins % 60 > 0 ? ` ${ws.durationMins % 60}m` : ''}`
                      : `${ws.durationMins}m`;
                    return (
                      <View key={i} style={{ marginLeft: 12, marginBottom: 2 }}>
                        <Text style={{ fontSize: 13, color: colors.textSecondary }}>
                          {ws.startTime} – {ws.endTime}  ({durLabel}){ws.repeatDaily ? '  (repeats daily)' : ''}
                          {ws.dogIds.length > 0 && post.dogNames && post.dogNames.length > 1
                            ? `  ·  ${resolveDogNames(ws.dogIds, post)}`
                            : ''}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              )}

              {/* Play sessions */}
              {post.playSessions && post.playSessions.length > 0 && (
                <View style={{ marginBottom: 10 }}>
                  <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 4 }}>🎾 Playtime</Text>
                  {post.playSessions.map((ps, i) => {
                    const durLabel = ps.durationMins >= 60
                      ? `${Math.floor(ps.durationMins / 60)}h${ps.durationMins % 60 > 0 ? ` ${ps.durationMins % 60}m` : ''}`
                      : `${ps.durationMins}m`;
                    return (
                      <View key={i} style={{ marginLeft: 12, marginBottom: 2 }}>
                        <Text style={{ fontSize: 13, color: colors.textSecondary }}>
                          {ps.flexible
                            ? `Flexible · ${durLabel}`
                            : `${ps.startTime} – ${ps.endTime}  (${durLabel})`}
                          {ps.repeatDaily ? '  (repeats daily)' : ''}
                          {ps.dogIds.length > 0 && post.dogNames && post.dogNames.length > 1
                            ? `  ·  ${resolveDogNames(ps.dogIds, post)}`
                            : ''}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              )}
            </View>
          )}

          {/* Free-text care details */}
          {post.careDetails ? (
            <Text style={[styles.careDetails, { color: colors.text, marginTop: 8 }]}>{post.careDetails}</Text>
          ) : null}
        </View>

        {/* ── Compensation (LAST before helpers) ── */}
        <View style={[styles.section, { backgroundColor: colors.surface, ...shadow.sm }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Compensation</Text>
          <Text style={[styles.compText, { color: colors.text }]}>{compensationLabel()}</Text>
          {(post.compensationType === 'payment' || post.compensationType === 'either') && (
            <View style={[styles.offAppNote, { backgroundColor: '#FFF9E6', borderColor: '#F0C040' }]}>
              <Text style={[styles.offAppNoteText, { color: '#7A6000' }]}>
                All payments are arranged and made outside of WatchDog. We do not process payments.
              </Text>
            </View>
          )}
        </View>

        {/* ── I Can Help button ── */}
        {!isOwner && post.status === 'open' && (() => {
          const alreadyResponded = respondents.some((r) => r.userId === user?.uid);
          if (alreadyResponded) {
            return (
              <TouchableOpacity
                style={[styles.helpBtn, styles.helpBtnAlreadyResponded]}
                accessibilityLabel="Messaged. Tap to view conversation"
                accessibilityRole="button"
                onPress={async () => {
                  try {
                    const convId = await getOrCreateConversation(user!.uid, post.posterId, post.id);
                    navigation.navigate('Chat' as any, { conversationId: convId, otherUserId: post.posterId });
                  } catch {
                    Alert.alert('Error', 'Could not open conversation');
                  }
                }}
              >
                <Text style={[styles.helpBtnText, { color: colors.primary, fontWeight: '700' }]}>Messaged! Tap to view conversation →</Text>
              </TouchableOpacity>
            );
          }
          return (
            <TouchableOpacity
              style={[styles.helpBtn, { backgroundColor: colors.primary, opacity: claiming ? 0.7 : 1 }]}
              onPress={handleHelpButtonPress}
              disabled={claiming}
              accessibilityLabel="I can help!"
              accessibilityRole="button"
            >
              <Text style={styles.helpBtnText}>{claiming ? 'Opening chat...' : 'I Can Help!'}</Text>
            </TouchableOpacity>
          );
        })()}

        {isOwner && respondents.length === 0 && (
          <View style={[styles.ownerNote, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.ownerNoteText, { color: colors.textSecondary }]}>
              👆 This is your post. Interested sitters will message you.
            </Text>
          </View>
        )}

        {/* ── Delete Post (owner only) ── */}
        {isOwner && post.status === 'open' && (
          <TouchableOpacity
            style={styles.deletePostBtn}
            onPress={() => {
              Alert.alert(
                'Delete Post',
                'Are you sure you want to delete this post? This cannot be undone.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: async () => {
                      try {
                        await cancelPost(post.id);
                        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                        navigation.goBack();
                      } catch (err) {
                        Alert.alert('Error', err instanceof Error ? err.message : 'Failed to delete');
                      }
                    } },
                ],
              );
            }}
            accessibilityLabel="Delete this post"
            accessibilityRole="button"
          >
            <Text style={styles.deletePostBtnText}>Delete Post</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </>
  );
};

// ─── Carousel Styles ──────────────────────────────────────────────────────────

const carouselStyles = StyleSheet.create({
  container: { width: SCREEN_WIDTH, height: CAROUSEL_HEIGHT, backgroundColor: '#111' },
  slide: { width: SCREEN_WIDTH, height: CAROUSEL_HEIGHT },
  image: { width: SCREEN_WIDTH, height: CAROUSEL_HEIGHT },
  placeholder: { width: SCREEN_WIDTH, height: CAROUSEL_HEIGHT, backgroundColor: '#1C1C1E', alignItems: 'center', justifyContent: 'center' },
  placeholderEmoji: { fontSize: 64, marginBottom: 8 },
  placeholderText: { fontSize: 16, color: '#666', fontWeight: '600' },
  dotsRow: { position: 'absolute', bottom: 12, width: '100%', flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 3.5 },
  dotActive: { backgroundColor: '#FFFFFF', width: 9, height: 9, borderRadius: 4.5 },
  dotInactive: { backgroundColor: 'rgba(255,255,255,0.45)' } });

// ─── Modal Styles ─────────────────────────────────────────────────────────────

const modalStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', justifyContent: 'center' },
  safeTop: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 },
  closeBtn: { alignSelf: 'flex-end', margin: 16, width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  closeBtnText: { color: '#FFFFFF', fontSize: 18, fontWeight: '700', lineHeight: 20 },
  slide: { width: SCREEN_WIDTH, flex: 1, justifyContent: 'center', alignItems: 'center' },
  image: { width: SCREEN_WIDTH, height: '100%' },
  safeBottom: { position: 'absolute', bottom: 0, left: 0, right: 0 },
  dotsRow: { paddingBottom: 24, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 3.5 },
  dotActive: { backgroundColor: '#FFFFFF', width: 9, height: 9, borderRadius: 4.5 },
  dotInactive: { backgroundColor: 'rgba(255,255,255,0.4)' } });

// ─── Screen Styles ────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingBottom: spacing.xl * 2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  notFound: { fontSize: 16 },
  section: { borderRadius: borderRadius.lg, padding: spacing.md, marginBottom: spacing.md, marginHorizontal: spacing.md, marginTop: spacing.md },
  sectionTitle: { fontSize: 18, fontWeight: '800', marginBottom: spacing.sm },

  // Care type banner
  careTypeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    marginBottom: 0,
    borderRadius: borderRadius.lg,
    borderWidth: 1.5,
    padding: spacing.md },
  careTypeBannerIcon: { fontSize: 30 },
  careTypeBannerLabel: { fontSize: 17, fontWeight: '800', marginBottom: 2 },
  careTypeSchedule: { fontSize: 14, fontWeight: '500' },

  // Poster
  posterRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  posterAvatar: { width: 48, height: 48, borderRadius: 24, borderWidth: 1 },
  posterAvatarPlaceholder: { width: 48, height: 48, borderRadius: 24, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  posterAvatarEmoji: { fontSize: 22 },
  posterInfo: { flex: 1 },
  posterNameRow: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap' },
  posterName: { fontSize: 16, fontWeight: '700' },
  ownerLabel: { fontSize: 13, fontWeight: '400', color: '#999999' },
  postedAt: { fontSize: 12, marginTop: 2 },
  statusBadge: { paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: borderRadius.full },
  statusBadgeText: { fontSize: 11, fontWeight: '700' },

  // Dog
  dogRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dogThumb: { width: 60, height: 60, borderRadius: borderRadius.md, borderWidth: 1 },
  dogThumbPlaceholder: { width: 60, height: 60, borderRadius: borderRadius.md, alignItems: 'center', justifyContent: 'center' },
  dogThumbEmoji: { fontSize: 28 },
  dogInfo: { flex: 1 },
  dogName: { fontSize: 17, fontWeight: '700' },
  dogBreed: { fontSize: 13, marginTop: 2 },

  // Dates
  dates: { fontSize: 16, fontWeight: '600' },

  // Compensation
  compText: { fontSize: 15, fontWeight: '400', marginBottom: spacing.sm },
  offAppNote: { borderWidth: 1, borderRadius: borderRadius.md, padding: spacing.sm, marginTop: spacing.xs },
  offAppNoteText: { fontSize: 13, lineHeight: 18, fontWeight: '500' },

  // Care details
  careDetailLine: { fontSize: 15, fontWeight: '600', marginBottom: 4 },
  careDetails: { fontSize: 14, lineHeight: 22 },

  // Interested Helpers RED section
  helpersSection: { borderRadius: borderRadius.lg, marginBottom: spacing.md, marginHorizontal: spacing.md, marginTop: spacing.lg, overflow: 'hidden', borderWidth: 2, borderColor: RED, backgroundColor: 'rgba(255,45,85,0.06)', shadowColor: RED, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.18, shadowRadius: 6, elevation: 4 },
  helpersSectionHeader: { backgroundColor: RED, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  helpersSectionTitle: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  rescheduleBanner: { marginHorizontal: spacing.md, marginTop: spacing.sm, borderWidth: 1.5, borderRadius: borderRadius.lg, padding: spacing.md },
  claimedBadge: { backgroundColor: 'rgba(255,255,255,0.25)', borderRadius: borderRadius.full, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  claimedBadgeText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  helperRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,45,85,0.25)' },
  helperAvatarTouchable: {},
  helperAvatar: { width: 44, height: 44, borderRadius: 22, borderWidth: 2, borderColor: RED },
  helperAvatarPlaceholder: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,45,85,0.15)', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: RED },
  helperAvatarEmoji: { fontSize: 20 },
  helperInfo: { flex: 1 },
  helperActions: { alignItems: 'flex-end', gap: spacing.xs },
  helperName: { fontSize: 15, fontWeight: '600', color: '#2D3436' },
  helperTap: { fontSize: 12, marginTop: 2 },
  helperApprovedLabel: { fontSize: 12, marginTop: 2, color: '#00B894', fontWeight: '600' },
  helperAcceptedPts: { fontSize: 12, marginTop: 2, color: '#00B894', fontWeight: '600' },
  helperMsgBtn: { paddingVertical: 2 },


  // Approve button
  approveBtn: { backgroundColor: RED, borderRadius: borderRadius.sm, paddingHorizontal: spacing.md, paddingVertical: 7 },
  approveBtnDisabled: { opacity: 0.5 },
  approveBtnText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },

  // Help button
  helpBtn: { padding: spacing.md, borderRadius: borderRadius.md, alignItems: 'center', marginTop: spacing.sm, marginBottom: spacing.sm, marginHorizontal: spacing.md },
  helpBtnAlreadyResponded: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: '#FF2D55' },
  helpBtnText: { color: '#fff', ...typography.button, fontSize: 17 },

  // Owner note
  ownerNote: { borderWidth: 1, borderRadius: borderRadius.md, padding: spacing.md, alignItems: 'center', marginHorizontal: spacing.md },
  ownerNoteText: { fontSize: 14 },
  deletePostBtn: { backgroundColor: '#FF3B3020', borderWidth: 1.5, borderColor: '#FF3B30', borderRadius: 12, padding: 14, alignItems: 'center' as const, marginHorizontal: 16, marginTop: 16 },
  deletePostBtnText: { color: '#FF3B30', fontSize: 16, fontWeight: '700' },

  // "I Can Help" modal
  helpModalOverlay: { flex: 1, justifyContent: 'flex-end' },
  helpModalCard: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: spacing.xl, paddingBottom: spacing.xl * 2, shadowColor: '#000', shadowOffset: { width: 0, height: -2 }, shadowOpacity: 0.15, shadowRadius: 12, elevation: 10 },
  helpModalTitle: { fontSize: 20, fontWeight: '800', marginBottom: spacing.xs, textAlign: 'center' },
  helpModalSubtitle: { fontSize: 15, textAlign: 'center', marginBottom: spacing.lg },
  helpModalAcceptBtn: { borderRadius: borderRadius.md, padding: spacing.md, alignItems: 'center', marginBottom: spacing.sm },
  helpModalBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  helpModalCancelLink: { alignItems: 'center', paddingVertical: spacing.sm },
  helpModalCancelText: { fontSize: 14 } });

export default PostDetailScreen;
