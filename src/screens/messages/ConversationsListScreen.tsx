import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Haptics from 'expo-haptics';
import { MessagesStackParamList } from '../../navigation/types';
import { useAuthContext } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { useMessaging } from '../../hooks/useMessaging';
import { useFavorites } from '../../hooks/useFavorites';
import { Conversation } from '../../models/types';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { spacing, borderRadius, shadow } from '../../config/theme';
import EmptyStateView from '../../components/common/EmptyStateView';

type Props = {
  navigation: NativeStackNavigationProp<MessagesStackParamList, 'ConversationsList'>;
};

const SYSTEM_SENDER_ID = 'swapdog-team';

const getOtherParticipantLabel = (participantIds: string[], myUid: string, names: Record<string, string>): string => {
  const otherId = participantIds.find((id) => id !== myUid) ?? '';
  if (otherId === SYSTEM_SENDER_ID) return '🐾 WatchDog Team';
  return names[otherId] ?? 'Loading...';
};

const ConversationsListScreen: React.FC<Props> = ({ navigation }) => {
  const { colors } = useTheme();
  const { user } = useAuthContext();
  const { subscribeToConversations } = useMessaging();
  const { isFavorite, addFavorite, removeFavorite, setNotifyOnPost } = useFavorites();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [nameCache, setNameCache] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!user) return;
    const unsub = subscribeToConversations(user.uid, setConversations);
    return unsub;
  }, [user]);

  // Resolve display names for all other participants
  useEffect(() => {
    if (!user) return;
    const otherIds: string[] = conversations
      .flatMap((c) => c.participantIds)
      .filter((id) => id !== user.uid && id !== SYSTEM_SENDER_ID && !nameCache[id]);
    const unique = Array.from(new Set(otherIds));
    if (unique.length === 0) return;

    unique.forEach(async (uid) => {
      try {
        const snap = await getDoc(doc(db, 'users', uid));
        const data = snap.data();
        if (data?.displayName) {
          setNameCache((prev) => ({ ...prev, [uid]: data.displayName }));
        }
      } catch { /* skip */ }
    });
  }, [conversations, user]);

  const handleStarPress = (otherId: string, otherName: string) => {
    if (otherId === SYSTEM_SENDER_ID) return;

    if (isFavorite(otherId)) {
      Alert.alert(
        'Unfavorite?',
        `Remove ${otherName} from your favorites? You won't get notified about their posts.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Unfavorite', style: 'destructive', onPress: () => removeFavorite(otherId) },
        ]
      );
      return;
    }

    Alert.alert(
      'Favorite this dog parent? ⭐',
      `It'll add ${otherName} to the top of your feed when they post requests.`,
      [
        { text: 'Not now', style: 'cancel' },
        {
          text: 'Yes, favorite!',
          onPress: () => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            addFavorite(otherId, false).then(() => {
              // Ask about post notifications
              Alert.alert(
                'Turn on post notifications? 🔔',
                `Get notified every time ${otherName} posts a new request so you never miss one.`,
                [
                  { text: 'No thanks', style: 'cancel' },
                  {
                    text: 'Yes, notify me!',
                    onPress: () => {
                      setNotifyOnPost(otherId, true);
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
  };

  const renderItem = ({ item }: { item: Conversation }) => {
    const otherId = item.participantIds.find((id) => id !== user?.uid) ?? '';
    const otherLabel = getOtherParticipantLabel(item.participantIds, user?.uid ?? '', nameCache);
    const unread = item.unreadCounts[user?.uid ?? ''] ?? 0;
    const starred = isFavorite(otherId);
    const isSystem = otherId === SYSTEM_SENDER_ID;

    return (
      <TouchableOpacity
        style={[styles.item, { backgroundColor: colors.surface, ...shadow.sm }]}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          navigation.navigate('Chat', { conversationId: item.id, otherUserId: otherId });
        }}
        accessibilityLabel={`Conversation with ${otherLabel}, last message: ${item.lastMessage ?? 'No messages yet'}`}
        accessibilityRole="button"
        accessibilityHint="Opens this conversation"
      >
        <View style={styles.info}>
          <Text style={[styles.otherName, { color: colors.primary }]} numberOfLines={1}>
            {otherLabel}
          </Text>
          <Text style={[styles.preview, { color: colors.text }]} numberOfLines={1}>
            {item.lastMessage ?? 'No messages yet'}
          </Text>
          {item.lastMessageAt && (
            <Text style={[styles.time, { color: colors.textSecondary }]}>
              {item.lastMessageAt.toLocaleDateString()}
            </Text>
          )}
        </View>
        {unread > 0 && (
          <View
            style={[styles.dot, { backgroundColor: '#FF2D55' }]}
            accessibilityLabel="Unread message"
          />
        )}
        {!isSystem && (
          <TouchableOpacity
            onPress={() => handleStarPress(otherId, otherLabel)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityLabel={starred ? `${otherLabel} is favorited` : `Favorite ${otherLabel}`}
            accessibilityRole="button"
            style={styles.starBtn}
          >
            <Text style={[styles.starIcon, { color: starred ? '#FFD700' : '#C0C0C0' }]}>{starred ? '★' : '☆'}</Text>
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        data={conversations}
        keyExtractor={(c) => c.id}
        ListEmptyComponent={<EmptyStateView emoji="💬" title="No conversations yet" subtitle="Start by requesting a swap" />}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { padding: spacing.md },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: borderRadius.lg,
    marginBottom: spacing.sm,
  },
  info: { flex: 1 },
  otherName: { fontSize: 14, fontWeight: '700', marginBottom: 2 },
  preview: { fontSize: 15 },
  time: { fontSize: 12, marginTop: 2 },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
    marginLeft: spacing.sm,
  },
  starBtn: {
    marginLeft: spacing.sm,
    padding: 4,
  },
  starIcon: {
    fontSize: 22,
  },
});

export default ConversationsListScreen;
