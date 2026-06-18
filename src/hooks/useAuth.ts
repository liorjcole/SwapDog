import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import { doc, setDoc, serverTimestamp, collection, query, where, getDocs, addDoc } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { auth, db } from '../config/firebase';
import { generateReferralCode, redeemReferralCode } from './useReferrals';
const REFERRAL_STORAGE_KEY = '@swapdog_referral_code';

export const useAuth = () => {
  /**
   * Creates a Firebase Auth account, then writes the Firestore user doc.
   * - Reads the validated referral code from AsyncStorage
   * - Looks up the code's createdBy userId to set referredBy
   * - Redeems the referral code (increments usedCount)
   * - Generates a unique referralCode for the new user
   * - Sets accountStatus = 'pending_approval' (they've passed the gate)
   * - Seeds points = 5 (welcome bonus)
   */
  const signUp = async (email: string, password: string): Promise<void> => {
    // Step 1: Create the Firebase Auth user — this is the only step that
    // should surface an error to the user. Once auth succeeds the auth-state
    // listener navigates away, so any subsequent Firestore errors would show
    // a misleading "Oops!" alert on the next screen.
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    const uid = credential.user.uid;

    // Step 2: Post-auth setup (referral, user doc, points).
    // Wrapped in its own try/catch so failures here never bubble up as a
    // user-facing "Oops!" error — auth already succeeded.
    try {
      // Read the referral code they entered at the gate
      let referredBy: string | undefined;
      let usedCode: string | undefined;

      try {
        const storedCode = await AsyncStorage.getItem(REFERRAL_STORAGE_KEY);
        if (storedCode) {
          usedCode = storedCode;
          const q = query(
            collection(db, 'referral_codes'),
            where('code', '==', storedCode),
          );
          const snap = await getDocs(q);
          if (!snap.empty) {
            referredBy = snap.docs[0].data().createdBy as string;
          }
          await redeemReferralCode(storedCode, uid);
        }
      } catch {
        // Non-fatal — proceed without referral linkage
      }

      // Generate this user's own referral code
      const newReferralCode = await generateReferralCode(uid);

      // Write user doc
      await setDoc(doc(db, 'users', uid), {
        email: credential.user.email,
        displayName: '',
        photoURL: '',
        bio: '',
        isOnboarded: false,
        referredBy: referredBy ?? null,
        referralCodeUsed: usedCode ?? null,
        referralCode: newReferralCode,
        points: 5,
        accountStatus: 'pending_approval',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      // Log the welcome bonus in points history
      await addDoc(collection(db, 'users', uid, 'pointsHistory'), {
        type: 'bonus',
        description: 'Welcome bonus — thanks for joining WatchDog!',
        points: 5,
        createdAt: serverTimestamp(),
      });
    } catch (postAuthErr) {
      // Log but don't throw — the user is already authenticated and
      // navigated to the onboarding flow. The auth-context listener will
      // retry fetching the user doc when the profile screen loads.
      console.warn('[useAuth] Post-signup setup failed (non-fatal):', postAuthErr);
    }
  };

  const signIn = async (email: string, password: string): Promise<void> => {
    await signInWithEmailAndPassword(auth, email, password);
  };

  const signOut = async (): Promise<void> => {
    await firebaseSignOut(auth);
  };

  return { signUp, signIn, signOut };
};
