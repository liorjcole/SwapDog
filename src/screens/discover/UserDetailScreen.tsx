import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, Alert, ActivityIndicator, Linking, Modal, TextInput, Keyboard } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import { DiscoverStackParamList } from '../../navigation/types';
import { useTheme } from '../../contexts/ThemeContext';
import AvatarImage from '../../components/common/AvatarImage';
import { smartDate } from '../../utils/dateHelpers';
import { useAuthContext } from '../../contexts/AuthContext';
import { useUsers } from '../../hooks/useUsers';
import { useDogs } from '../../hooks/useDogs';
import { useSwaps } from '../../hooks/useSwaps';
import { useReviews } from '../../hooks/useReviews';
import { useMessaging } from '../../hooks/useMessaging';
import { useBlocking } from '../../hooks/useBlocking';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { User, Dog, SwapPost, Review } from '../../models/types';
import { spacing, borderRadius, shadow, typography } from '../../config/theme';
import { formatDogAge } from '../../utils/formatDogAge';
import StarRating from '../../components/common/StarRating';
import LoadingSpinner from '../../components/common/LoadingSpinner';

type Props = {
  navigation: NativeStackNavigationProp<DiscoverStackParamList, 'UserDetail'>;
  route: RouteProp<DiscoverStackParamList, 'UserDetail'>;
};

/** Build the message text for a SwapPost share */
function buildPostMessage(post: SwapPost): string {
  const start = smartDate(post.startDate);
  const end = smartDate(post.endDate);
  return (
    `Hey! I posted a request for dog sitting — check it out!\n\n` +
    `Dog: ${post.dogName}${post.dogBreed ? ` (${post.dogBreed})` : ''}\n` +
    `Dates: ${start} – ${end}\n` +
    `Details: ${post.careDetails}`
  );
}


/** Extract clean Instagram handle from any format (handle, @handle, full URL) */
const cleanIgHandle = (raw: string): string => {
  const s = raw.trim();
  const urlMatch = s.match(/instagram\.com\/([a-zA-Z0-9_.]+)/);
  if (urlMatch) return urlMatch[1];
  return s.replace(/^@/, '');
};

const UserDetailScreen: React.FC<Props> = ({ navigation, route }) => {
  const { colors } = useTheme();
  const { userProfile: me } = useAuthContext();
  const { getUser } = useUsers();
  const { getDogsByOwner } = useDogs();
  const { getMyPosts } = useSwaps();
  const { getOrCreateConversation, sendMessage } = useMessaging();
  const { blockUser, unblockUser, isBlockedByMe } = useBlocking();
  const [blocking, setBlocking] = useState(false);
  const [showBlockFeedback, setShowBlockFeedback] = useState(false);
  const [blockFeedbackText, setBlockFeedbackText] = useState('');
  const [blockedUserName, setBlockedUserName] = useState('');

  const userId = route.params?.userId ?? '';

  const [user, setUser] = useState<User | null>(null);
  const [dogs, setDogs] = useState<Dog[]>([]);
  const [myOpenPost, setMyOpenPost] = useState<SwapPost | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const { getReviewsForUser } = useReviews();
  const [reviews, setReviews] = useState<Review[]>([]);
  const [reviewFilter, setReviewFilter] = useState<string>('all');

  useEffect(() => {
    const load = async () => {
      const [u, d] = await Promise.all([
        getUser(userId),
        getDogsByOwner(userId),
      ]);
      setUser(u);
      setDogs(d);

      // Load the current user's open post (if any)
      if (me?.id) {
        const myPosts = await getMyPosts(me.id);
        const open = myPosts.find((p) => p.status === 'open') ?? null;
        setMyOpenPost(open);
      }
      // Load reviews
      try {
        const revs = await getReviewsForUser(userId);
        setReviews(revs);
      } catch { /* non-fatal */ }
      setLoading(false);
    };
    void load();
  }, [userId, me?.id]);

  const handleMessageUser = async () => {
    if (!me?.id || !user) return;
    setSending(true);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const convId = await getOrCreateConversation(me.id, user.id);
      navigation.navigate('Chat' as any, { conversationId: convId, otherUserId: user.id });
    } catch (err: unknown) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Failed to open conversation');
    } finally {
      setSending(false);
    }
  };

  const handleSendPost = async () => {
    if (!me?.id || !user || !myOpenPost) return;
    setSending(true);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const convId = await getOrCreateConversation(me.id, user.id);
      await sendMessage(convId, me.id, buildPostMessage(myOpenPost));
      // Navigate to the chat
      navigation.navigate('Discover'); // pop to Discover first, then navigate via parent
      // Use the Messages tab instead — navigate directly
      // We rely on the parent navigator's navigate approach
      Alert.alert(
        'Post Sent!',
        `Your post was sent to ${user.displayName}. Check Messages to continue the conversation.`,
        [{ text: 'OK' }],
      );
    } catch {
      Alert.alert('Error', 'Failed to send post. Please try again.');
    } finally {
      setSending(false);
    }
  };

  if (loading) return <LoadingSpinner />;
  if (!user) return null;

  const showSendButton = me && me.id !== user.id;
  const submitBlockFeedback = async (feedback: string) => {
    try {
      if (feedback.trim()) {
        const feedbackRef = doc(db, 'blockReports', `${me?.id || 'unknown'}_${userId}_${Date.now()}`);
        await setDoc(feedbackRef, {
          reporterId: me?.id || 'unknown',
          reporterName: me?.displayName || 'Unknown',
          blockedUserId: userId,
          blockedUserName: blockedUserName,
          reason: feedback.trim(),
          createdAt: serverTimestamp(),
        });
      }
    } catch (err) {
      console.error('[BlockFeedback] Failed to save:', err);
    }
    setShowBlockFeedback(false);
    setBlockFeedbackText('');
    navigation.goBack();
  };

  const blocked = isBlockedByMe(userId);

  const handleBlockToggle = () => {
    if (blocked) {
      Alert.alert(
        'Unblock User',
        `Are you sure you want to unblock ${user.displayName}? They will be able to see your posts and message you again.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Unblock',
            onPress: async () => {
              setBlocking(true);
              try {
                await unblockUser(userId);
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                Alert.alert('Unblocked', `${user.displayName} has been unblocked.`);
              } catch { Alert.alert('Error', 'Failed to unblock user.'); }
              finally { setBlocking(false); }
            },
          },
        ],
      );
    } else {
      Alert.alert(
        'Block User',
        `Are you sure you want to block ${user.displayName}? They won't be able to see your posts or message you, and your conversation will be removed.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Block',
            style: 'destructive',
            onPress: async () => {
              setBlocking(true);
              try {
                await blockUser(userId);
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                setBlockedUserName(user.displayName);
                setShowBlockFeedback(true);
              } catch { Alert.alert('Error', 'Failed to block user.'); }
              finally { setBlocking(false); }
            },
          },
        ],
      );
    }
  };

  return (
    <>
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.surface, ...shadow.sm }]}>
        <AvatarImage
          photoURL={user.photoURL}
          displayName={user.displayName}
          size={90}
          style={styles.avatar}
          emojiSize={36}
        />
        <Text style={[styles.name, { color: colors.text }]} accessibilityRole="header">{user.displayName}</Text>
        {user.locationName && (
          <Text style={[styles.location, { color: colors.textSecondary }]}>{user.locationName}</Text>
        )}
        {user.rating !== undefined && (
          <View style={styles.ratingRow}>
            <StarRating rating={Math.round(user.rating)} />
            <Text style={[styles.ratingText, { color: colors.textSecondary }]}>({user.reviewCount ?? 0} reviews)</Text>
          </View>
        )}
        {user.bio && <Text style={[styles.bio, { color: colors.textSecondary }]}>{user.bio}</Text>}
        {user.instagramHandle ? (
          <TouchableOpacity
            onPress={() => { const h = cleanIgHandle(user.instagramHandle ?? ''); Linking.openURL('https://www.instagram.com/' + h + '/'); }}
            style={styles.igRow}
          >
            <Text style={[styles.igHandle, { color: colors.primary }]}>@{cleanIgHandle(user.instagramHandle ?? '')}</Text>
          </TouchableOpacity>
        ) : null}
        <Text style={[styles.pointsBadge, { color: colors.textSecondary }]}>
          {user.points ?? 0} points
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Dogs</Text>
        {dogs.map((dog) => (
          <TouchableOpacity
            key={dog.id}
            style={[styles.dogCard, { backgroundColor: colors.surface, ...shadow.sm }]}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); navigation.navigate('DogDetail', { dogId: dog.id }); }}
            accessibilityLabel={`${dog.name}, ${dog.breed}. Tap to view dog profile.`}
            accessibilityRole="button"
          >
            <View style={styles.dogCardRow}>
              {dog.photoURLs && dog.photoURLs.length > 0 ? (
                <Image source={{ uri: dog.photoURLs[0] }} style={styles.dogPhoto} />
              ) : (
                <View style={[styles.dogPhotoPlaceholder, { backgroundColor: colors.primary + '22' }]}>
                  <Text style={{ fontSize: 20 }}></Text>
                </View>
              )}
              <View style={styles.dogCardInfo}>
                <Text style={[styles.dogName, { color: colors.text }]}>{dog.name}</Text>
                <Text style={[styles.dogBreed, { color: colors.textSecondary }]}>{dog.breed} • {formatDogAge(dog.ageYears, dog.ageMonths)} • {dog.size}</Text>
              </View>
            </View>
          </TouchableOpacity>
        ))}
      </View>

      {/* ── Reviews with filters ── */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Reviews</Text>

        {reviews.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow}>
            {/* "All" filter */}
            <TouchableOpacity
              onPress={() => setReviewFilter('all')}
              style={[
                styles.filterChip,
                { borderColor: reviewFilter === 'all' ? colors.primary : colors.border,
                  backgroundColor: reviewFilter === 'all' ? colors.primary + '15' : 'transparent' },
              ]}
            >
              <Text style={[styles.filterText, { color: reviewFilter === 'all' ? colors.primary : colors.textSecondary }]}>
                All ({reviews.length})
              </Text>
            </TouchableOpacity>

            {/* "As Owner" filter */}
            {reviews.some((r) => r.targetType === 'owner') && (
              <TouchableOpacity
                onPress={() => setReviewFilter('owner')}
                style={[
                  styles.filterChip,
                  { borderColor: reviewFilter === 'owner' ? colors.primary : colors.border,
                    backgroundColor: reviewFilter === 'owner' ? colors.primary + '15' : 'transparent' },
                ]}
              >
                <Text style={[styles.filterText, { color: reviewFilter === 'owner' ? colors.primary : colors.textSecondary }]}>
                  As Owner ({reviews.filter((r) => r.targetType === 'owner').length})
                </Text>
              </TouchableOpacity>
            )}

            {/* "As Caregiver" filter */}
            {reviews.some((r) => r.targetType === 'caregiver') && (
              <TouchableOpacity
                onPress={() => setReviewFilter('caregiver')}
                style={[
                  styles.filterChip,
                  { borderColor: reviewFilter === 'caregiver' ? colors.primary : colors.border,
                    backgroundColor: reviewFilter === 'caregiver' ? colors.primary + '15' : 'transparent' },
                ]}
              >
                <Text style={[styles.filterText, { color: reviewFilter === 'caregiver' ? colors.primary : colors.textSecondary }]}>
                  As Caregiver ({reviews.filter((r) => r.targetType === 'caregiver').length})
                </Text>
              </TouchableOpacity>
            )}

            {/* Per-dog filters */}
            {dogs.map((dog) => {
              const dogRevs = reviews.filter((r) => r.targetType === 'dog' && r.dogId === dog.id);
              if (dogRevs.length === 0) return null;
              return (
                <TouchableOpacity
                  key={dog.id}
                  onPress={() => setReviewFilter('dog:' + dog.id)}
                  style={[
                    styles.filterChip,
                    { borderColor: reviewFilter === 'dog:' + dog.id ? colors.primary : colors.border,
                      backgroundColor: reviewFilter === 'dog:' + dog.id ? colors.primary + '15' : 'transparent' },
                  ]}
                >
                  <Text style={[styles.filterText, { color: reviewFilter === 'dog:' + dog.id ? colors.primary : colors.textSecondary }]}>
                    🐾 {dog.name} ({dogRevs.length})
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}

        {/* Filtered review list */}
        {reviews.length === 0 ? (
          <Text style={{ color: colors.textSecondary, fontSize: 14 }}>No reviews yet</Text>
        ) : (
          reviews
            .filter((r) => {
              if (reviewFilter === 'all') return true;
              if (reviewFilter === 'owner') return r.targetType === 'owner';
              if (reviewFilter === 'caregiver') return r.targetType === 'caregiver';
              if (reviewFilter.startsWith('dog:')) return r.targetType === 'dog' && r.dogId === reviewFilter.replace('dog:', '');
              return true;
            })
            .map((rev) => (
              <View key={rev.id} style={[styles.reviewCard, { backgroundColor: colors.surface }]}>
                <View style={styles.reviewHeader}>
                  <StarRating rating={Math.round(rev.rating)} size={16} />
                  <Text style={[styles.reviewBadge, {
                    color: rev.targetType === 'dog' ? '#FF9500' : rev.targetType === 'caregiver' ? '#34C759' : colors.primary,
                  }]}>
                    {rev.targetType === 'dog' ? ('🐾 ' + (rev.dogName ?? 'Dog')) : rev.targetType === 'caregiver' ? '🤝 Caregiver' : '👤 Owner'}
                  </Text>
                </View>
                {(rev.note || rev.comment) ? (
                  <Text style={[styles.reviewNote, { color: colors.text }]}>{rev.note || rev.comment}</Text>
                ) : null}
                <Text style={[styles.reviewMeta, { color: colors.textSecondary }]}>
                  {rev.reviewerName} • {rev.createdAt instanceof Date ? rev.createdAt.toLocaleDateString() : ''}
                </Text>
              </View>
            ))
        )}
      </View>

      {showSendButton && (
        <View style={styles.section}>
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: colors.primary, opacity: sending ? 0.7 : 1 }]}
            onPress={() => { void handleMessageUser(); }}
            disabled={sending}
            accessibilityLabel={`Message ${user.displayName}`}
            accessibilityRole="button"
          >
            {sending ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.actionBtnText}>Message {user.displayName}</Text>
            )}
          </TouchableOpacity>
        </View>
      )}

      {/* Block / Unblock — shown for all other users */}
      {me && me.id !== user.id && (
        <View style={[styles.section, { paddingTop: 0 }]}>
          <TouchableOpacity
            onPress={handleBlockToggle}
            disabled={blocking}
            activeOpacity={0.7}
            style={styles.blockBtn}
            accessibilityLabel={blocked ? `Unblock ${user.displayName}` : `Block ${user.displayName}`}
            accessibilityRole="button"
          >
            {blocking ? (
              <ActivityIndicator size="small" color={blocked ? '#34C759' : '#FF3B30'} />
            ) : (
              <Text style={[styles.blockBtnText, { color: blocked ? '#34C759' : '#FF3B30' }]}>
                {blocked ? 'Unblock User' : 'Block User'}
              </Text>
            )}
          </TouchableOpacity>
          {!blocked && (
            <Text style={styles.blockNote}>
              This action can't be reversed unless you contact support.
            </Text>
          )}
        </View>
      )}
    </ScrollView>

      {/* Block Feedback Modal */}
      <Modal visible={showBlockFeedback} transparent animationType="fade">
        <TouchableOpacity
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 24 }}
          activeOpacity={1}
          onPress={() => Keyboard.dismiss()}
        >
          <View style={{ backgroundColor: colors.surface, borderRadius: 16, padding: 24, width: '100%', maxWidth: 340 }}>
            <Text style={{ fontSize: 22, fontWeight: '700', color: colors.text, textAlign: 'center', marginBottom: 4 }}>
              ✅ Block Successful
            </Text>
            <Text style={{ fontSize: 14, color: colors.textSecondary, textAlign: 'center', marginBottom: 16, lineHeight: 20 }}>
              {blockedUserName} has been blocked.
            </Text>
            <Text style={{ fontSize: 14, color: colors.text, textAlign: 'center', marginBottom: 12, lineHeight: 20 }}>
              WatchDog is built on trust and a positive community. If this person was acting inappropriately, please let us know — we take reports seriously and may take action including account termination.
            </Text>
            <TextInput
              style={{
                borderWidth: 1, borderColor: colors.border, borderRadius: 10,
                padding: 12, fontSize: 15, color: colors.text,
                backgroundColor: colors.background, minHeight: 90,
                textAlignVertical: 'top',
              }}
              placeholder="Why did you block this person? (optional)"
              placeholderTextColor={colors.textSecondary}
              value={blockFeedbackText}
              onChangeText={setBlockFeedbackText}
              multiline
              maxLength={500}
              returnKeyType="done"
              blurOnSubmit={true}
            />
            <TouchableOpacity
              onPress={() => void submitBlockFeedback(blockFeedbackText)}
              style={{ backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 14, marginTop: 14, alignItems: 'center' }}
              activeOpacity={0.8}
            >
              <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>
                {blockFeedbackText.trim() ? 'Submit & Continue' : 'Skip'}
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { alignItems: 'center', padding: spacing.lg },
  avatar: { width: 90, height: 90, borderRadius: 45, marginBottom: spacing.sm },
  name: { ...typography.h2, marginBottom: spacing.xs },
  location: { fontSize: 14, marginBottom: spacing.xs },
  ratingRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.xs },
  ratingText: { fontSize: 13, marginLeft: spacing.xs },
  bio: { fontSize: 14, textAlign: 'center', marginTop: spacing.sm },
  section: { padding: spacing.lg },
  sectionTitle: { ...typography.h3, marginBottom: spacing.md },
  dogCard: { padding: spacing.md, borderRadius: borderRadius.md, marginBottom: spacing.sm },
  dogName: { fontSize: 16, fontWeight: '700' },
  dogBreed: { fontSize: 13, marginTop: 2 },
  actionBtn: { padding: spacing.md, borderRadius: borderRadius.md, alignItems: 'center' },
  actionBtnText: { color: '#fff', ...typography.button },
  disabledBanner: {
    padding: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    alignItems: 'center',
  },
  disabledBannerText: { fontSize: 14, textAlign: 'center' },
  igRow: { marginTop: 8 },
  igHandle: { fontSize: 14, fontWeight: '600' },
  pointsBadge: { fontSize: 14, marginTop: 6, fontWeight: '500' },
  dogCardRow: { flexDirection: 'row', alignItems: 'center' },
  dogPhoto: { width: 50, height: 50, borderRadius: 25, marginRight: 12 },
  dogPhotoPlaceholder: { width: 50, height: 50, borderRadius: 25, marginRight: 12, alignItems: 'center', justifyContent: 'center' },
  dogCardInfo: { flex: 1 },
  // Reviews
  filterRow: { marginBottom: spacing.md },
  filterChip: { borderWidth: 1.5, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6, marginRight: 8 },
  filterText: { fontSize: 13, fontWeight: '600' },
  reviewCard: { padding: spacing.md, borderRadius: borderRadius.md, marginBottom: spacing.sm },
  reviewHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  reviewBadge: { fontSize: 12, fontWeight: '700' },
  reviewNote: { fontSize: 14, lineHeight: 20, marginBottom: 6 },
  reviewMeta: { fontSize: 12 },
  blockBtn: {
    alignItems: 'center',
    marginTop: 8,
    paddingVertical: 14,
    borderWidth: 0,
    backgroundColor: 'transparent',
    borderColor: 'transparent',
  },
  blockBtnText: {
    fontSize: 15,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  blockNote: {
    fontSize: 12,
    color: '#999',
    textAlign: 'center',
    marginTop: 4,
    fontStyle: 'italic',
  },
});

export default UserDetailScreen;
