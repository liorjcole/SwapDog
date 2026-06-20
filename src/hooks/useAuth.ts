import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import { doc, setDoc, serverTimestamp, collection, query, where, getDocs, addDoc } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { auth, db } from '../config/firebase';
import { useAuthContext } from '../contexts/AuthContext';
import { generateReferralCode, redeemReferralCode } from './useReferrals';
const REFERRAL_STORAGE_KEY = '@swapdog_referral_code';

export const useAuth = () => {
  const { setSignupInProgress, refreshUserProfile } = useAuthContext();
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
    // Tell auth listener to skip profile fetch — we haven't written the doc yet
    setSignupInProgress(true);
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

      // Generate referral code — non-fatal if it fails
      let newReferralCode = '';
      try {
        newReferralCode = await generateReferralCode(uid);
      } catch {
        console.warn('[useAuth] Referral code generation failed (non-fatal)');
      }

      // Write user doc — this MUST succeed for points to be seeded
      await setDoc(doc(db, 'users', uid), {
        email: credential.user.email?.toLowerCase() ?? '',
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

      // Log the welcome bonus in points history (non-fatal)
      try {
        await addDoc(collection(db, 'users', uid, 'pointsHistory'), {
          type: 'bonus',
          description: 'Welcome bonus — thanks for joining WatchDog!',
          points: 5,
          createdAt: serverTimestamp(),
        });
      } catch {
        console.warn('[useAuth] Points history write failed (non-fatal — points still seeded on user doc)');
      }
    } catch (postAuthErr) {
      console.warn('[useAuth] Post-signup setup failed (non-fatal):', postAuthErr);
    } finally {
      // Signup writes done (or failed) — let the auth listener fetch normally again
      setSignupInProgress(false);
      // Force-refresh the profile now that the user doc exists
      await refreshUserProfile();
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
