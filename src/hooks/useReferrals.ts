import {
  collection,
  doc,
  getDoc,
  query,
  where,
  getDocs,
  updateDoc,
  setDoc,
  increment,
  arrayUnion,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../config/firebase';
import { ReferralCode } from '../models/types';
import { toDate } from '../utils/firestoreConverters';

/** Designated promo codes that grant 30-day free access. */
export const PROMO_CODES = new Set(['WATCHDOGFREE']);

/** Returns true if `code` is a designated promo code (case-insensitive). */
export const isPromoCode = (code: string): boolean => {
  if (!code) return false;
  return PROMO_CODES.has(code.trim().toUpperCase());
};

const COLLECTION = 'referral_codes';

/**
 * Looks up a referral code document in Firestore.
 * Returns the ReferralCode if the code is valid (active and under maxUses),
 * otherwise returns null.
 */
export const validateReferralCode = async (
  code: string,
): Promise<ReferralCode | null> => {
  try {
    const trimmed = code.trim().toUpperCase();

    // Master referral code — always valid for testing / friends & family
    if (trimmed === '8888' || trimmed === '1717') {
      return {
        code: '8888',
        createdBy: 'system',
        isActive: true,
        usedBy: [],
        maxUses: 999999,
        usedCount: 0,
        createdAt: new Date(),
      };
    }

    const q = query(
      collection(db, COLLECTION),
      where('code', '==', trimmed),
    );
    const snapshot = await getDocs(q);
    if (snapshot.empty) return null;

    const docSnap = snapshot.docs[0];
    const data = docSnap.data();
    const referralCode: ReferralCode = {
      code: data.code,
      createdBy: data.createdBy,
      isActive: data.isActive,
      usedBy: data.usedBy ?? [],
      maxUses: data.maxUses,
      usedCount: data.usedCount,
      createdAt: toDate(data.createdAt),
    };

    if (!referralCode.isActive) return null;
    if (referralCode.usedCount >= referralCode.maxUses) return null;

    return referralCode;
  } catch {
    return null;
  }
};

/**
 * Marks the referral code as used by the given userId.
 * Increments usedCount and appends userId to usedBy array.
 * Also sets referredBy on the user document to the code's createdBy userId.
 */
export const redeemReferralCode = async (
  code: string,
  userId: string,
): Promise<void> => {
  const trimmed = code.trim().toUpperCase();
  const q = query(
    collection(db, COLLECTION),
    where('code', '==', trimmed),
  );
  const snapshot = await getDocs(q);
  if (snapshot.empty) {
    throw new Error('Referral code not found');
  }
  const codeDoc = snapshot.docs[0];
  const docRef = codeDoc.ref;
  const createdBy = codeDoc.data().createdBy as string;

  // Atomically update the referral code document
  await updateDoc(docRef, {
    usedCount: increment(1),
    usedBy: arrayUnion(userId),
  });

  // Set referredBy on the user's document
  try {
    await updateDoc(doc(db, 'users', userId), {
      referredBy: createdBy,
      updatedAt: serverTimestamp(),
    });
  } catch {
    // User doc may not exist yet at this point (called from ReferralCodeScreen
    // before auth signup) — that's OK; useAuth.signUp will set referredBy.
  }
};

/**
 * Generates a new unique 8-char alphanumeric referral code for a user,
 * writes it to the referral_codes collection, and stores it on the
 * user's own document for quick access.
 * Returns the generated code string.
 */
export const generateReferralCode = async (userId: string): Promise<string> => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  const newDocRef = doc(collection(db, COLLECTION));
  await setDoc(newDocRef, {
    code,
    createdBy: userId,
    isActive: true,
    usedBy: [],
    maxUses: 10,
    usedCount: 0,
    createdAt: serverTimestamp(),
  });

  return code;
};

/**
 * Ensures the user has a referral code. If they already have one (on their
 * user doc), returns it. Otherwise generates a new one, writes it to both
 * `referral_codes` and the user document, then returns it.
 */
export const ensureReferralCode = async (userId: string): Promise<string> => {
  // Check the user doc first
  const userDocSnap = await getDoc(doc(db, 'users', userId));
  if (userDocSnap.exists()) {
    const existing = userDocSnap.data().referralCode as string | undefined;
    if (existing && existing.trim().length > 0) return existing;
  }

  // Generate a new code
  const newCode = await generateReferralCode(userId);

  // Persist it on the user doc so it's visible immediately via userProfile
  await updateDoc(doc(db, 'users', userId), {
    referralCode: newCode,
    updatedAt: serverTimestamp(),
  });

  return newCode;
};

// ── Referral list helpers ────────────────────────────────────────────────────

/**
 * Returns all users who were referred by the given userId.
 * Queries the `users` collection for documents where `referredBy === userId`.
 */
export const getMyReferrals = async (userId: string): Promise<import('../models/types').User[]> => {
  try {
    const q = query(
      collection(db, 'users'),
      where('referredBy', '==', userId),
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map((docSnap) => {
      const d = docSnap.data();
      return {
        id: docSnap.id,
        email: d.email ?? '',
        displayName: d.displayName ?? '',
        photoURL: d.photoURL,
        bio: d.bio,
        location: d.location,
        locationName: d.locationName,
        pushToken: d.pushToken,
        pushTokens: d.pushTokens,
        isOnboarded: d.isOnboarded ?? false,
        createdAt: toDate(d.createdAt),
        updatedAt: toDate(d.updatedAt),
        rating: d.rating,
        reviewCount: d.reviewCount,
        referredBy: d.referredBy,
        referralCode: d.referralCode ?? '',
        points: d.points ?? 0,
        accountStatus: d.accountStatus ?? 'pending_referral',
        conductAgreedAt: d.conductAgreedAt ? toDate(d.conductAgreedAt) : undefined,
        contractSignedAt: d.contractSignedAt ? toDate(d.contractSignedAt) : undefined,
        vettingScheduledAt: d.vettingScheduledAt ? toDate(d.vettingScheduledAt) : undefined,
      } as import('../models/types').User;
    });
  } catch {
    return [];
  }
};

/**
 * Returns the count of users referred by the given userId.
 */
export const getReferralCount = async (userId: string): Promise<number> => {
  try {
    const q = query(
      collection(db, 'users'),
      where('referredBy', '==', userId),
    );
    const snapshot = await getDocs(q);
    return snapshot.size;
  } catch {
    return 0;
  }
};
