import {
  collection,
  addDoc,
  getDocs,
  onSnapshot,
  query,
  where,
  orderBy,
  serverTimestamp,
  updateDoc,
  doc,
} from 'firebase/firestore';
import { db } from '../config/firebase';
import { Message, Conversation } from '../models/types';
import { toDate } from '../utils/firestoreConverters';

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
    senderId: string,
    text: string
  ): Promise<void> => {
    // Add the message
    await addDoc(collection(db, 'conversations', convId, 'messages'), {
      conversationId: convId,
      senderId,
      text,
      read: false,
      createdAt: serverTimestamp(),
    });
    // Update conversation metadata
    await updateDoc(doc(db, 'conversations', convId), {
      lastMessage: text,
      lastMessageAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  };

  const subscribeToMessages = (
    convId: string,
    cb: (messages: Message[]) => void
  ): (() => void) => {
    const q = query(
      collection(db, 'conversations', convId, 'messages'),
      orderBy('createdAt', 'asc')
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
      where('participantIds', 'array-contains', userId)
    );
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => parseConversation(d.id, d.data() as Record<string, unknown>))
      .sort((a, b) => (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0));
  };

  /**
   * Subscribe to conversations for a user.
   *
   * NOTE: Firestore does not allow combining array-contains with orderBy on a
   * different field without a composite index. To avoid requiring a manually
   * deployed index (which breaks the app until deployed), we query with
   * array-contains only and sort the results client-side.
   */
  const subscribeToConversations = (
    userId: string,
    cb: (conversations: Conversation[]) => void
  ): (() => void) => {
    const q = query(
      collection(db, 'conversations'),
      where('participantIds', 'array-contains', userId)
      // ⚠️ orderBy('updatedAt', 'desc') intentionally omitted — requires a
      // composite index. Sorting is done client-side below instead.
    );
    return onSnapshot(
      q,
      (snap) => {
        const convs = snap.docs
          .map((d) => parseConversation(d.id, d.data() as Record<string, unknown>))
          // Sort most-recently-updated first (mirrors the removed orderBy)
          .sort((a, b) => (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0));
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
    // Look for an existing conversation between these two participants
    const q = query(
      collection(db, 'conversations'),
      where('participantIds', 'array-contains', userIdA)
    );
    const snap = await getDocs(q);
    const existing = snap.docs.find((d) => {
      const participants = (d.data().participantIds as string[]) ?? [];
      return participants.includes(userIdB);
    });
    if (existing) return existing.id;

    // Create a new conversation
    const ref = await addDoc(collection(db, 'conversations'), {
      participantIds: [userIdA, userIdB],
      swapRequestId: swapRequestId ?? null,
      unreadCounts: { [userIdA]: 0, [userIdB]: 0 },
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return ref.id;
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

  return {
    sendMessage,
    subscribeToMessages,
    getConversations,
    subscribeToConversations,
    getOrCreateConversation,
    markConversationRead,
  };
};

// ── System sender constants ───────────────────────────────────────────────────
const SYSTEM_SENDER_ID = 'swapdog-team';

const WELCOME_TEXT =
  'Welcome to WatchDog! 🐾\n\n' +
  "We're so happy to have you in the family! You're now part of a trusted " +
  "community of dog lovers who look out for each other's pups.\n\n" +
  "We've given you 5 points to get started — use them to post your first " +
  "pet sitting request or save them up!\n\n" +
  'If you ever need help or have questions, reach out to us at david@joinwatchdog.com.\n\n' +
  'Happy watching! 🐕';

/**
 * Creates a welcome conversation from WatchDog Team the first time a user
 * completes onboarding (contract signed). Safe to call multiple times —
 * it checks for an existing welcome conversation before creating one.
 */
export const sendWelcomeMessageIfNeeded = async (userId: string): Promise<void> => {
  // Check whether the welcome conversation already exists
  const q = query(
    collection(db, 'conversations'),
    where('participantIds', 'array-contains', userId)
  );
  const snap = await getDocs(q);
  const alreadyExists = snap.docs.some((d) => {
    const participants = (d.data().participantIds as string[]) ?? [];
    return participants.includes(SYSTEM_SENDER_ID);
  });
  if (alreadyExists) return;

  // Create the welcome conversation
  const convRef = await addDoc(collection(db, 'conversations'), {
    participantIds: [userId, SYSTEM_SENDER_ID],
    swapRequestId: null,
    unreadCounts: { [userId]: 1 },
    lastMessage: 'Welcome to WatchDog! 🐾',
    lastMessageAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  // Add the welcome message itself.
  // Security rules allow senderId === 'swapdog-team' when written by an
  // authenticated participant, so this is permitted without a Cloud Function.
  await addDoc(collection(db, 'conversations', convRef.id, 'messages'), {
    conversationId: convRef.id,
    senderId: SYSTEM_SENDER_ID,
    text: WELCOME_TEXT,
    read: false,
    createdAt: serverTimestamp(),
  });
};
