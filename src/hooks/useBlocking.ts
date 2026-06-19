import { useState, useEffect } from 'react';
import {
  collection, query, where, onSnapshot, addDoc, deleteDoc, getDocs,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../config/firebase';
import { useAuthContext } from '../contexts/AuthContext';

/**
 * Hook for blocking / unblocking users.
 *
 * Uses a top-level `blocks` Firestore collection:
 *   { blockerId, blockedId, createdAt }
 *
 * Subscribes to both directions so the UI can hide posts and
 * conversations involving blocked or blocking users.
 */
export const useBlocking = () => {
  const { user } = useAuthContext();
  const uid = user?.uid;

  // Users I actively blocked
  const [blockedByMe, setBlockedByMe] = useState<Set<string>>(new Set());
  // Users who blocked me
  const [blockedMe, setBlockedMe] = useState<Set<string>>(new Set());

  // Subscribe: users I blocked
  useEffect(() => {
    if (!uid) return;
    const q = query(collection(db, 'blocks'), where('blockerId', '==', uid));
    return onSnapshot(q, (snap) => {
      setBlockedByMe(new Set(snap.docs.map((d) => d.data().blockedId as string)));
    }, () => {});
  }, [uid]);

  // Subscribe: users who blocked me
  useEffect(() => {
    if (!uid) return;
    const q = query(collection(db, 'blocks'), where('blockedId', '==', uid));
    return onSnapshot(q, (snap) => {
      setBlockedMe(new Set(snap.docs.map((d) => d.data().blockerId as string)));
    }, () => {});
  }, [uid]);

  /** Combined set — any user that should be hidden from my feed / inbox */
  const hiddenUserIds = new Set([...blockedByMe, ...blockedMe]);

  const isBlockedByMe = (userId: string) => blockedByMe.has(userId);

  const blockUser = async (userId: string) => {
    if (!uid || uid === userId) return;
    await addDoc(collection(db, 'blocks'), {
      blockerId: uid,
      blockedId: userId,
      createdAt: serverTimestamp(),
    });
  };

  const unblockUser = async (userId: string) => {
    if (!uid) return;
    const q = query(
      collection(db, 'blocks'),
      where('blockerId', '==', uid),
      where('blockedId', '==', userId),
    );
    const snap = await getDocs(q);
    const deletes = snap.docs.map((d) => deleteDoc(d.ref));
    await Promise.all(deletes);
  };

  return { blockUser, unblockUser, isBlockedByMe, hiddenUserIds };
};
