import React, { useEffect, useState, useRef } from 'react';
import { BlurView } from 'expo-blur';
import * as ImagePicker from 'expo-image-picker';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '../../config/firebase';
import {
  View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet, Platform, KeyboardAvoidingView, Alert, Modal, Image, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import { MessagesStackParamList } from '../../navigation/types';
import { useAuthContext } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { useMessaging } from '../../hooks/useMessaging';
import { useFavorites } from '../../hooks/useFavorites';
import { Message, SwapPost } from '../../models/types';
import { collection, query, where, getDocs, getDoc, doc as firestoreDoc, updateDoc as firestoreUpdateDoc, serverTimestamp as fsServerTimestamp, addDoc as fsAddDoc } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { smartDate } from '../../utils/dateHelpers';
import RescheduleReviewModal from '../../components/common/RescheduleReviewModal';
import { spacing, borderRadius } from '../../config/theme';
import MessageBubble from '../../components/common/MessageBubble';

type Props = {
  navigation: NativeStackNavigationProp<MessagesStackParamList, 'Chat'>;
  route: RouteProp<MessagesStackParamList, 'Chat'>;
};

const ChatScreen: React.FC<Props> = ({ navigation, route }) => {
  const conversationId = route.params?.conversationId ?? '';
  const otherUserId = route.params?.otherUserId ?? '';
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useAuthContext();
  const { subscribeToMessages, sendMessage, markConversationRead } = useMessaging();
  const { isFavorite, addFavorite, removeFavorite, setNotifyOnPost } = useFavorites();
  const starred = isFavorite(otherUserId);
  const isSystem = otherUserId === 'swapdog-team';
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [reschedulePost, setReschedulePost] = useState<SwapPost | null>(null);
  const [showRescheduleModal, setShowRescheduleModal] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendingPhoto, setSendingPhoto] = useState(false);
  const [showPhotoPicker, setShowPhotoPicker] = useState(false);
  const [otherUserName, setOtherUserName] = useState('Chat');
  const [otherUserPhoto, setOtherUserPhoto] = useState<string | null>(null);

  // Resolve other user's display name for header
  useEffect(() => {
    if (!otherUserId || otherUserId === 'swapdog-team') {
      setOtherUserName(otherUserId === 'swapdog-team' ? '🐾 WatchDog Team' : 'Chat');
      return;
    }
    getDoc(firestoreDoc(db, 'users', otherUserId)).then((snap) => {
      const data = snap.data();
      if (data?.displayName) setOtherUserName(data.displayName);
      if (data?.photoURL) setOtherUserPhoto(data.photoURL);
    }).catch(() => {});
  }, [otherUserId]);
  const listRef = useRef<FlatList<Message>>(null);

  // Mark conversation as read when the user opens the chat
  useEffect(() => {
    if (user?.uid) {
      void markConversationRead(conversationId, user.uid);
    }
  }, [conversationId, user?.uid, markConversationRead]);

  useEffect(() => {
    const unsub = subscribeToMessages(conversationId, (msgs) => {
      setMessages(msgs.reverse()); // inverted for FlatList inverted
    });
    return unsub;
  }, [conversationId]);

  const handleSend = async () => {
    if (!text.trim() || !user || sending) return;
    const toSend = text.trim();
    setText('');
    setSending(true);
    try {
      await sendMessage(conversationId, user.uid, toSend);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } finally {
      setSending(false);
    }
  };

  // ── Photo sending ──
  const handlePhotoPress = () => setShowPhotoPicker(true);

  const pickPhoto = async () => {
    setShowPhotoPicker(false);
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
    });
    if (!result.canceled && result.assets?.[0]) {
      await uploadAndSendPhoto(result.assets[0].uri);
    }
  };

  const takePhoto = async () => {
    setShowPhotoPicker(false);
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Camera Access', 'Please allow camera access in Settings to take photos.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      quality: 0.7,
    });
    if (!result.canceled && result.assets?.[0]) {
      await uploadAndSendPhoto(result.assets[0].uri);
    }
  };

  const uploadAndSendPhoto = async (uri: string) => {
    if (!user) return;
    setSendingPhoto(true);
    try {
      const response = await fetch(uri);
      if (!response) throw new Error('Failed to read image');
      const blob = await response.blob();
      const fileRef = storageRef(storage, `chat-images/${conversationId}/${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`);
      await uploadBytes(fileRef, blob, { contentType: 'image/jpeg' });
      const downloadURL = await getDownloadURL(fileRef);

      const msgData = {
        conversationId,
        senderId: user.uid,
        text: '',
        type: 'image',
        imageURL: downloadURL,
        createdAt: fsServerTimestamp(),
        read: false,
      };
      await fsAddDoc(collection(db, 'conversations', conversationId, 'messages'), msgData);
      await firestoreUpdateDoc(firestoreDoc(db, 'conversations', conversationId), {
        lastMessage: '📷 Photo',
        lastMessageAt: fsServerTimestamp(),
        updatedAt: fsServerTimestamp(),
      });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      console.error('[ChatScreen] Photo send failed:', err);
      Alert.alert('Error', 'Failed to send photo. Please try again.');
    } finally {
      setSendingPhoto(false);
    }
  };

  const handleBack = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      // Cross-tab navigation: came from another stack.
      // Navigate to the ConversationsList in MessagesTab.
      (navigation as any).getParent()?.navigate('MessagesTab', {
        screen: 'ConversationsList' });
    }
  };

  const handleFavoriteToggle = () => {
    if (isSystem || !otherUserId) return;
    if (starred) {
      Alert.alert(
        'Remove from favorites?',
        `${otherUserName} will no longer appear at the top of your feed.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Remove',
            style: 'destructive',
            onPress: () => removeFavorite(otherUserId),
          },
        ],
      );
    } else {
      Alert.alert(
        'Favorite this dog parent? ⭐',
        `It'll add ${otherUserName} to the top of your feed when they post requests.`,
        [
          { text: 'Not now', style: 'cancel' },
          {
            text: 'Yes, favorite!',
            onPress: () => {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              addFavorite(otherUserId, false).then(() => {
                Alert.alert(
                  'Turn on post notifications? 🔔',
                  `Get notified every time ${otherUserName} posts a new request so you never miss one.`,
                  [
                    { text: 'No thanks', style: 'cancel' },
                    {
                      text: 'Yes, notify me!',
                      onPress: () => {
                        setNotifyOnPost(otherUserId, true);
                        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                      },
                    },
                  ],
                );
              });
            },
          },
        ],
      );
    }
  };

  // Hide the native navigation header — we use our own custom header
  useEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

  // ── Open reschedule review modal for a reschedule-type message ──
  const handleReviewReschedule = async (msg: Message) => {
    if (!msg.metadata?.postId) return;
    try {
      const postSnap = await getDoc(firestoreDoc(db, 'swapPosts', msg.metadata.postId));
      if (!postSnap.exists()) return;
      const data = postSnap.data();
      const toDate = (v: any): Date => {
        if (!v) return new Date();
        if (v.toDate) return v.toDate();
        if (typeof v === 'string') return new Date(v);
        return new Date();
      };
      const post = {
        id: postSnap.id,
        posterId: data.posterId,
        posterName: data.posterName,
        dogId: data.dogId ?? '',
        dogName: data.dogName ?? '',
        startDate: toDate(data.startDate),
        endDate: toDate(data.endDate),
        careDetails: data.careDetails ?? '',
        compensationType: data.compensationType ?? 'points',
        pointsCost: data.pointsCost ?? 0,
        status: data.status,
        claimedBy: data.claimedBy,
        rescheduleProposedStart: data.rescheduleProposedStart ? toDate(data.rescheduleProposedStart) : (msg.metadata.proposedStart ? new Date(msg.metadata.proposedStart) : undefined),
        rescheduleProposedEnd: data.rescheduleProposedEnd ? toDate(data.rescheduleProposedEnd) : (msg.metadata.proposedEnd ? new Date(msg.metadata.proposedEnd) : undefined),
        rescheduleNote: data.rescheduleNote,
        rescheduleProposedBy: data.rescheduleProposedBy,
        createdAt: toDate(data.createdAt) } as SwapPost;
      setReschedulePost(post);
      setShowRescheduleModal(true);
    } catch (err) {
      console.warn('[ChatScreen] handleReviewReschedule error:', err);
    }
  };

  const handleRescheduleRespond = async (
    action: 'accept' | 'reject' | 'propose',
    note?: string,
    newStart?: Date,
    newEnd?: Date,
  ) => {
    if (!reschedulePost || !user) return;
    try {
      const postRef = firestoreDoc(db, 'swapPosts', reschedulePost.id);
      let msgText = '';
      if (action === 'accept') {
        await firestoreUpdateDoc(postRef, {
          startDate: reschedulePost.rescheduleProposedStart,
          endDate: reschedulePost.rescheduleProposedEnd,
          status: 'claimed',
          rescheduleProposedStart: null, rescheduleProposedEnd: null,
          rescheduleNote: null, rescheduleProposedBy: null,
          updatedAt: fsServerTimestamp() });
        msgText = note
          ? `I accept the new dates (${smartDate(reschedulePost.rescheduleProposedStart!)}\u2013${smartDate(reschedulePost.rescheduleProposedEnd!)}). ${note}`
          : `I accept the new dates (${smartDate(reschedulePost.rescheduleProposedStart!)}\u2013${smartDate(reschedulePost.rescheduleProposedEnd!)}).`;
      } else if (action === 'reject') {
        await firestoreUpdateDoc(postRef, {
          status: 'claimed',
          rescheduleProposedStart: null, rescheduleProposedEnd: null,
          rescheduleNote: null, rescheduleProposedBy: null,
          updatedAt: fsServerTimestamp() });
        msgText = note ? `I can't do the new dates. ${note}` : `I can't do the proposed dates.`;
      } else if (action === 'propose') {
        await firestoreUpdateDoc(postRef, {
          rescheduleProposedStart: newStart, rescheduleProposedEnd: newEnd,
          rescheduleNote: note || null, rescheduleProposedBy: user.uid,
          updatedAt: fsServerTimestamp() });
        msgText = note
          ? `How about ${smartDate(newStart!)}\u2013${smartDate(newEnd!)} instead? ${note}`
          : `How about ${smartDate(newStart!)}\u2013${smartDate(newEnd!)} instead?`;
      }
      // Send chat message
      if (conversationId && msgText) {
        const msgType = action === 'propose' ? 'reschedule' : 'text';
        const msgData: Record<string, any> = {
          conversationId, senderId: user.uid, text: msgText,
          read: false, createdAt: fsServerTimestamp(), type: msgType };
        if (action === 'propose' && newStart && newEnd) {
          msgData.metadata = { postId: reschedulePost.id, proposedStart: newStart.toISOString(), proposedEnd: newEnd.toISOString() };
        }
        await fsAddDoc(collection(db, 'conversations', conversationId, 'messages'), msgData);
        await firestoreUpdateDoc(firestoreDoc(db, 'conversations', conversationId), {
          lastMessage: msgText, lastMessageAt: fsServerTimestamp(), updatedAt: fsServerTimestamp() });
      }
      setShowRescheduleModal(false);
      setReschedulePost(null);
    } catch (err) {
      console.warn('[ChatScreen] reschedule respond error:', err);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
    >
      {/* ── Custom in-component header — always visible, always has back ── */}
      <View
        style={[
          styles.customHeader,
          {
            backgroundColor: colors.surface,
            paddingTop: insets.top + 8,
            borderBottomColor: colors.border },
        ]}
      >
        <TouchableOpacity
          onPress={handleBack}
          style={styles.backBtn}
          accessibilityLabel="Go back"
          accessibilityRole="button"
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Text style={[styles.backIcon, { color: colors.primary }]}>‹</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.headerCenter}
          onPress={() => {
            if (!isSystem && otherUserId) {
              navigation.navigate('UserDetail', { userId: otherUserId });
            }
          }}
          activeOpacity={isSystem ? 1 : 0.6}
          accessibilityLabel={`View ${otherUserName}'s profile`}
          accessibilityRole="button"
        >
          {otherUserPhoto ? (
            <Image source={{ uri: otherUserPhoto }} style={styles.headerAvatar} />
          ) : (
            <View style={[styles.headerAvatarPlaceholder, { backgroundColor: colors.primary + '22' }]}>
              <Text style={{ fontSize: 32 }}>{isSystem ? '🐾' : '👤'}</Text>
            </View>
          )}
          <Text style={[styles.headerTitle, { color: colors.text, textDecorationLine: isSystem ? 'none' : 'underline' }]} numberOfLines={1}>
            {otherUserName}
          </Text>
        </TouchableOpacity>
        <View style={styles.headerSpacer} />
      </View>

      {/* Favorite banner — toggles between unfavorited/favorited state */}
      {!isSystem && otherUserId !== '' && (
        <TouchableOpacity
          style={[styles.favBanner, { backgroundColor: starred ? '#FFF8E1' : colors.primary + '12' }]}
          onPress={handleFavoriteToggle}
          accessibilityLabel={starred ? 'Favorited dog parent' : 'Favorite this dog parent'}
          accessibilityRole="button"
        >
          <Text style={[styles.favBannerText, { color: starred ? '#E6A800' : colors.primary }]}>
            {starred ? '★ Favorited!' : '☆ Favorite this dog parent?'}
          </Text>
        </TouchableOpacity>
      )}

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => m.id}
        inverted
        renderItem={({ item }) => (
          <MessageBubble
            text={item.text}
            isMe={item.senderId === user?.uid}
            imageURL={item.imageURL}
            createdAt={item.createdAt}
            type={item.type}
            onReviewReschedule={item.type === 'reschedule' ? () => handleReviewReschedule(item) : undefined}
          />
        )}
        contentContainerStyle={styles.list}
      />
      {/* Reschedule review modal (triggered from "Review Reschedule" link in chat) */}
      {reschedulePost && (
        <RescheduleReviewModal
          visible={showRescheduleModal}
          onClose={() => setShowRescheduleModal(false)}
          proposedStart={reschedulePost.rescheduleProposedStart!}
          proposedEnd={reschedulePost.rescheduleProposedEnd!}
          originalStart={reschedulePost.startDate}
          originalEnd={reschedulePost.endDate}
          proposerName={reschedulePost.posterName}
          proposerNote={reschedulePost.rescheduleNote}
          onRespond={handleRescheduleRespond}
        />
      )}
      {/* Photo picker modal with blur */}
      <Modal
        visible={showPhotoPicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowPhotoPicker(false)}
      >
        <TouchableOpacity
          style={styles.pickerOverlay}
          activeOpacity={1}
          onPress={() => setShowPhotoPicker(false)}
        >
          <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
          <View style={styles.pickerCard}>
            <TouchableOpacity style={styles.pickerOption} onPress={takePhoto} activeOpacity={0.7}>
              <Text style={styles.pickerOptionText}>📸  Take Photo</Text>
            </TouchableOpacity>
            <View style={styles.pickerDivider} />
            <TouchableOpacity style={styles.pickerOption} onPress={pickPhoto} activeOpacity={0.7}>
              <Text style={styles.pickerOptionText}>🖼️  Choose from Library</Text>
            </TouchableOpacity>
            <View style={{ height: 10 }} />
            <TouchableOpacity
              style={[styles.pickerOption, styles.pickerCancel]}
              onPress={() => setShowPhotoPicker(false)}
              activeOpacity={0.7}
            >
              <Text style={[styles.pickerOptionText, { color: '#FF3B30' }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      <View style={[styles.inputRow, { backgroundColor: colors.surface, borderTopColor: colors.border, paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
        <TouchableOpacity
          style={styles.photoBtn}
          onPress={handlePhotoPress}
          disabled={sendingPhoto}
          accessibilityLabel="Send a photo"
          accessibilityRole="button"
        >
          {sendingPhoto ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Text style={[styles.photoBtnText, { color: colors.primary }]}>📷</Text>
          )}
        </TouchableOpacity>
        <TextInput
          style={[styles.input, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
          placeholder="Message..."
          placeholderTextColor={colors.textSecondary}
          value={text}
          onChangeText={setText}
          multiline
          maxLength={1000}
          autoCorrect={true}
          spellCheck={true}
          autoCapitalize="sentences"
          accessibilityLabel="Message input"
          accessibilityRole="none"
        />
        <TouchableOpacity
          style={[styles.sendBtn, { backgroundColor: text.trim() ? colors.primary : colors.border }]}
          onPress={handleSend}
          disabled={!text.trim() || sending}
          accessibilityLabel="Send message"
          accessibilityRole="button"
          accessibilityHint="Sends your message"
        >
          <Text style={styles.sendBtnText}>➤</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  // ── Custom header ──────────────────────────────────────────────────────────
  customHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 50,
    paddingLeft: 4,
    paddingRight: 8 },
  backIcon: {
    fontSize: 36,
    lineHeight: 40,
    fontWeight: '300' },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerAvatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    marginBottom: 4,
  },
  headerAvatarPlaceholder: {
    width: 72,
    height: 72,
    borderRadius: 36,
    marginBottom: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  headerSpacer: { minWidth: 50 },
  // ── Chat body ──────────────────────────────────────────────────────────────
  list: { padding: spacing.xs },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: spacing.sm,
    borderTopWidth: 1 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    maxHeight: 100,
    marginRight: spacing.sm,
    fontSize: 15 },
  sendBtn: {
    width: 40, height: 40, borderRadius: 20,
    justifyContent: 'center', alignItems: 'center' },
  sendBtnText: { color: '#fff', fontSize: 16 },
  photoBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 4,
  },
  photoBtnText: {
    fontSize: 22,
  },
  pickerOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pickerCard: {
    width: 280,
    borderRadius: 16,
    backgroundColor: 'rgba(44, 44, 46, 0.92)',
    overflow: 'hidden',
  },
  pickerOption: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  pickerOptionText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '500',
  },
  pickerDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    marginHorizontal: 16,
  },
  pickerCancel: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255, 255, 255, 0.15)',
  },
  favBanner: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  favBannerText: {
    fontSize: 14,
    fontWeight: '600',
  },
});

export default ChatScreen;
