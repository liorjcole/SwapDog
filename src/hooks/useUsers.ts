import { useCallback } from 'react';
import {
  doc,
  getDoc,
  updateDoc,
  collection,
  query,
  getDocs,
} from 'firebase/firestore';
import { db } from '../config/firebase';
import { User, GeoPoint, AccountStatus } from '../models/types';
import { toDate } from '../utils/firestoreConverters';

const parseUser = (id: string, data: Record<string, unknown>): User => ({
  id,
  email: data.email as string,
  displayName: data.displayName as string,
  photoURL: data.photoURL as string | undefined,
  bio: data.bio as string | undefined,
  location: data.location as GeoPoint | undefined,
  locationName: data.locationName as string | undefined,
  pushToken: data.pushToken as string | undefined,
  pushTokens: data.pushTokens as string[] | undefined,
  isOnboarded: (data.isOnboarded as boolean) ?? false,
  createdAt: toDate(data.createdAt as Parameters<typeof toDate>[0]),
  updatedAt: toDate(data.updatedAt as Parameters<typeof toDate>[0]),
  rating: data.rating as number | undefined,
  reviewCount: data.reviewCount as number | undefined,
  // Referral & account lifecycle
  referredBy: data.referredBy as string | undefined,
  referralCode: (data.referralCode as string) ?? '',
  points: (data.points as number) ?? 0,
  accountStatus: ((data.accountStatus as AccountStatus) ?? 'pending_referral'),
  conductAgreedAt: data.conductAgreedAt
    ? toDate(data.conductAgreedAt as Parameters<typeof toDate>[0])
    : undefined,
  contractSignedAt: data.contractSignedAt
    ? toDate(data.contractSignedAt as Parameters<typeof toDate>[0])
    : undefined,
  vettingScheduledAt: data.vettingScheduledAt
    ? toDate(data.vettingScheduledAt as Parameters<typeof toDate>[0])
    : undefined,
  instagramHandle: data.instagramHandle as string | undefined,
});

export const useUsers = () => {
  // Stable references — wrapped in useCallback so callers can include them in
  // dependency arrays without triggering infinite re-render loops.
  const getUser = useCallback(async (id: string): Promise<User | null> => {
    const snap = await getDoc(doc(db, 'users', id));
    if (!snap.exists()) return null;
    return parseUser(snap.id, snap.data() as Record<string, unknown>);
  }, []);

  const updateUser = useCallback(async (id: string, data: Partial<User>): Promise<void> => {
    await updateDoc(doc(db, 'users', id), { ...data, updatedAt: new Date() });
  }, []);

  const getUsersByLocation = useCallback(async (
    center: GeoPoint,
    radiusKm: number,
  ): Promise<User[]> => {
    const snap = await getDocs(query(collection(db, 'users')));
    const all = snap.docs.map((d) => parseUser(d.id, d.data() as Record<string, unknown>));
    return all.filter((u) => {
      if (!u.location) return false;
      const dLat = (u.location.latitude - center.latitude) * 111;
      const dLng =
        (u.location.longitude - center.longitude) *
        111 *
        Math.cos((center.latitude * Math.PI) / 180);
      return Math.sqrt(dLat * dLat + dLng * dLng) <= radiusKm;
    });
  }, []); // no deps — pure computation + stable firebase refs

  return { getUser, updateUser, getUsersByLocation };
};
