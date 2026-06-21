import {
  doc,
  getDoc,
  runTransaction,
} from 'firebase/firestore';
import { db } from '../config/firebase';

/**
 * Hook for points balance operations.
 * Uses Firestore transactions for atomic debit/credit.
 */
export function usePoints() {
  /**
   * Get the current points balance for a user.
   */
  const getBalance = async (userId: string): Promise<number> => {
    const snap = await getDoc(doc(db, 'users', userId));
    if (!snap.exists()) return 0;
    const data = snap.data() as Record<string, unknown>;
    return (data.points as number) ?? 0;
  };

  /**
   * Add points to a user's balance (e.g. sitter receives points after swap).
   */
  const addPoints = async (userId: string, amount: number): Promise<void> => {
    const userRef = doc(db, 'users', userId);
    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(userRef);
      if (!snap.exists()) throw new Error(`User ${userId} not found`);
      const current = (snap.data().points as number) ?? 0;
      transaction.update(userRef, { points: current + amount, updatedAt: new Date() });
    });
  };

  /**
   * Deduct points from a user's balance (e.g. requester pays after swap).
   * By default throws if user has insufficient points.
   * Pass allowNegative=true for penalty deductions (e.g. late cancellation)
   * which should go through even if balance drops below zero.
   */
  const deductPoints = async (userId: string, amount: number, allowNegative = false): Promise<void> => {
    const userRef = doc(db, 'users', userId);
    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(userRef);
      if (!snap.exists()) throw new Error(`User ${userId} not found`);
      const current = (snap.data().points as number) ?? 0;
      if (!allowNegative && current < amount) {
        throw new Error(`Insufficient points: balance ${current}, required ${amount}`);
      }
      transaction.update(userRef, { points: current - amount, updatedAt: new Date() });
    });
  };

  /**
   * Transfer points atomically from requester to sitter on swap completion.
   * Only called when sitterPreference === 'points'.
   */
  const transferPoints = async (
    fromUserId: string,
    toUserId: string,
    amount: number
  ): Promise<void> => {
    const fromRef = doc(db, 'users', fromUserId);
    const toRef = doc(db, 'users', toUserId);
    await runTransaction(db, async (transaction) => {
      const [fromSnap, toSnap] = await Promise.all([
        transaction.get(fromRef),
        transaction.get(toRef),
      ]);
      if (!fromSnap.exists()) throw new Error(`User ${fromUserId} not found`);
      if (!toSnap.exists()) throw new Error(`User ${toUserId} not found`);
      const fromBalance = (fromSnap.data().points as number) ?? 0;
      const toBalance = (toSnap.data().points as number) ?? 0;
      if (fromBalance < amount) {
        throw new Error(`Insufficient points: balance ${fromBalance}, required ${amount}`);
      }
      transaction.update(fromRef, { points: fromBalance - amount, updatedAt: new Date() });
      transaction.update(toRef, { points: toBalance + amount, updatedAt: new Date() });
    });
  };

  return { getBalance, addPoints, deductPoints, transferPoints };
}
