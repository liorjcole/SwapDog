import {
  collection,
  query,
  orderBy,
  getDocs,
  Timestamp,
} from 'firebase/firestore';
import { db } from '../config/firebase';
import { toDate } from '../utils/firestoreConverters';

export type PointsEventType = 'sitting' | 'referral' | 'bonus' | 'deduction' | 'other';

export interface PointsHistoryEntry {
  id: string;
  type: PointsEventType;
  description: string;
  points: number;          // positive = earned, negative = spent
  createdAt: Date;
  relatedPostId?: string;
}

/** Icon per event type */
export const pointsEventIcon: Record<PointsEventType, string> = {
  sitting: 'S',
  referral: 'R',
  bonus: 'B',
  deduction: 'D',
  other: 'P',
};

/** Normalize legacy descriptions so old Firestore entries show current wording. */
const normalizeDescription = (desc: string): string => {
  if (desc.includes('Welcome bonus') || desc.includes('thanks for joining')) {
    return 'Welcome to WatchDog!';
  }
  return desc;
};

const parseEntry = (id: string, data: Record<string, unknown>): PointsHistoryEntry => ({
  id,
  type: (data.type as PointsEventType) ?? 'other',
  description: normalizeDescription((data.description as string) ?? ''),
  points: (data.points as number) ?? 0,
  createdAt: toDate(data.createdAt as Parameters<typeof toDate>[0]),
  relatedPostId: data.relatedPostId as string | undefined,
});

export const usePointsHistory = () => {
  /**
   * Fetch all points history for a user, most recent first.
   * Collection path: users/{uid}/pointsHistory
   */
  const getHistory = async (userId: string): Promise<PointsHistoryEntry[]> => {
    const ref = collection(db, 'users', userId, 'pointsHistory');
    const q = query(ref, orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);
    return snap.docs.map((d) => parseEntry(d.id, d.data() as Record<string, unknown>));
  };

  return { getHistory };
};
