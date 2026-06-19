import { useEffect, useState, useCallback } from 'react';
import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { db } from '../config/firebase';
import { useAuthContext } from '../contexts/AuthContext';

export interface FavoriteEntry {
  userId: string;
  notifyOnPost: boolean;
  createdAt: Date | null;
}

/**
 * Subscribe to the current user's favorites subcollection.
 * Provides helpers to add/remove favorites and toggle post notifications.
 *
 * Firestore path: users/{uid}/favorites/{favoriteUserId}
 * Each doc: { notifyOnPost: boolean, createdAt: Timestamp }
 */
export function useFavorites() {
  const { user } = useAuthContext();
  const [favorites, setFavorites] = useState<FavoriteEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // Real-time listener on the favorites subcollection
  useEffect(() => {
    if (!user?.uid) {
      setFavorites([]);
      setLoading(false);
      return;
    }

    const colRef = collection(db, 'users', user.uid, 'favorites');
    const unsub = onSnapshot(
      colRef,
      (snap) => {
        const entries: FavoriteEntry[] = snap.docs.map((d) => {
          const data = d.data();
          return {
            userId: d.id,
            notifyOnPost: data.notifyOnPost === true,
            createdAt: data.createdAt?.toDate?.() ?? null,
          };
        });
        setFavorites(entries);
        setLoading(false);
      },
      () => setLoading(false),
    );

    return unsub;
  }, [user?.uid]);

  const isFavorite = useCallback(
    (userId: string): boolean => favorites.some((f) => f.userId === userId),
    [favorites],
  );

  const getFavorite = useCallback(
    (userId: string): FavoriteEntry | undefined =>
      favorites.find((f) => f.userId === userId),
    [favorites],
  );

  const addFavorite = useCallback(
    async (favoriteUserId: string, notifyOnPost = false) => {
      if (!user?.uid) return;
      const docRef = doc(db, 'users', user.uid, 'favorites', favoriteUserId);
      await setDoc(docRef, {
        notifyOnPost,
        createdAt: serverTimestamp(),
      });
    },
    [user?.uid],
  );

  const removeFavorite = useCallback(
    async (favoriteUserId: string) => {
      if (!user?.uid) return;
      const docRef = doc(db, 'users', user.uid, 'favorites', favoriteUserId);
      await deleteDoc(docRef);
    },
    [user?.uid],
  );

  const setNotifyOnPost = useCallback(
    async (favoriteUserId: string, notify: boolean) => {
      if (!user?.uid) return;
      const docRef = doc(db, 'users', user.uid, 'favorites', favoriteUserId);
      await updateDoc(docRef, { notifyOnPost: notify });
    },
    [user?.uid],
  );

  /** Set of favorited user IDs for fast lookups */
  const favoriteIds = new Set(favorites.map((f) => f.userId));

  return {
    favorites,
    favoriteIds,
    loading,
    isFavorite,
    getFavorite,
    addFavorite,
    removeFavorite,
    setNotifyOnPost,
  };
}
