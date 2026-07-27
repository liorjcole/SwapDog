import {
  collection,
  getDocs,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  limitToLast,
  updateDoc,
  deleteDoc,
  doc,
} from 'firebase/firestore';
import { auth, db } from '../config/firebase';
import { Message, Conversation } from '../models/types';
import { toDate } from '../utils/firestoreConverters';
import {
  getOrCreateConversationSecure,
  SecureMessageOptions,
  sendMessageSecure,
} from '../services/secureOperations';

const parseMessage = (id: string, data: Record<string, unknown>): Message => ({
  id,
  conversationId: data.conversationId as string,
  senderId: data.senderId as string,
  text: data.text as string,
  createdAt: toDate(data.createdAt as Parameters<typeof toDate>[0]),
  read: (data.read as boolean) ?? false,
  type: (data.type as Message['type']) ?? 'text',
  imageURL: data.imageURL as string | undefined,
  metadata: data.metadata as Message['metadata'],
});

const parseConversation = (id: string, data: Record<string, unknown>): Conversation => ({
  id,
  participantIds: (data.participantIds as string[]) ?? [],
  swapRequestId: data.swapRequestId as string | undefined,
  lastMessage: data.lastMessage as string | undefined,
  lastMessageAt: data.lastMessageAt ? toDate(data.lastMessageAt as Parameters<typeof toDate>[0]) : undefined,
  unreadCounts: (data.unreadCounts as Record<string, number>) ?? {},
  createdAt: toDate(data.createdAt as Parameters<typeof toDate>[0]),
  updatedAt: toDate(data.updatedAt as Parameters<typeof toDate>[0]),
});

export const useMessaging = () => {
  const sendMessage = async (
    convId: string,
    _senderId: string,
    text: string,
    options?: SecureMessageOptions,
  ): Promise<void> => {
    if (!auth.currentUser?.uid) throw new Error('Sign in to send a message.');
    await sendMessageSecure(convId, text, options);
  };

  const subscribeToMessages = (
    convId: string,
    cb: (messages: Message[]) => void
  ): (() => void) => {
    const q = query(
      collection(db, 'conversations', convId, 'messages'),
      orderBy('createdAt', 'asc'),
      limitToLast(200)
    );
    return onSnapshot(
      q,
      (snap) => {
        const msgs = snap.docs.map((d) =>
          parseMessage(d.id, d.data() as Record<string, unknown>)
        );
        cb(msgs);
      },
      (error) => {
        console.warn('[useMessaging] subscribeToMessages error:', error.message);
        cb([]);
      }
    );
  };

  const getConversations = async (userId: string): Promise<Conversation[]> => {
    const q = query(
      collection(db, 'conversations'),
      where('participantIds', 'array-contains', userId),
      orderBy('updatedAt', 'desc'),
      limit(100)
    );
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => parseConversation(d.id, d.data() as Record<string, unknown>))
      .sort((a, b) => (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0));
  };

  /**
   * Subscribe to conversations for a user.
   *
   * Query is bounded and ordered by Firestore. Requires the deployed composite
   * index on (participantIds array, updatedAt desc).
   */
  const subscribeToConversations = (
    userId: string,
    cb: (conversations: Conversation[]) => void
  ): (() => void) => {
    const q = query(
      collection(db, 'conversations'),
      where('participantIds', 'array-contains', userId),
      orderBy('updatedAt', 'desc'),
      limit(100)
    );
    return onSnapshot(
      q,
      (snap) => {
        const convs = snap.docs
          .map((d) => parseConversation(d.id, d.data() as Record<string, unknown>));
        cb(convs);
      },
      (error) => {
        console.warn('[useMessaging] subscribeToConversations error:', error.message);
        cb([]);
      }
    );
  };

  /**
   * Find an existing conversation between two users, or create a new one.
   * Optionally links it to a swapRequestId.
   */
  const getOrCreateConversation = async (
    userIdA: string,
    userIdB: string,
    swapRequestId?: string
  ): Promise<string> => {
    const currentUserId = auth.currentUser?.uid;
    if (!currentUserId || currentUserId !== userIdA) {
      throw new Error('Sign in to start a conversation.');
    }
    const result = await getOrCreateConversationSecure(userIdB, swapRequestId);
    return result.conversationId;
  };

  /**
   * Mark a conversation as read for the current user by resetting their
   * unreadCount to 0 in the conversation document.
   */
  const markConversationRead = async (convId: string, userId: string): Promise<void> => {
    try {
      await updateDoc(doc(db, 'conversations', convId), {
        [`unreadCounts.${userId}`]: 0,
      });
    } catch {
      // Non-fatal — don't surface to user
    }
  };
  /** Delete a specific message from a conversation */
  const deleteMessage = async (conversationId: string, messageId: string): Promise<void> => {
    await deleteDoc(doc(db, 'conversations', conversationId, 'messages', messageId));
  };

  return {
    sendMessage,
    deleteMessage,
    subscribeToMessages,
    getConversations,
    subscribeToConversations,
    getOrCreateConversation,
    markConversationRead,
  };
};
