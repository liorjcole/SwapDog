import React, { createContext, useContext, useEffect, useState, useRef, ReactNode } from 'react';
import { User as FirebaseUser, onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { auth, db } from '../config/firebase';
import { User } from '../models/types';
import { toDate } from '../utils/firestoreConverters';
import { REFERRAL_STORAGE_KEY } from '../screens/auth/ReferralCodeScreen';


interface AuthContextType {
  user: FirebaseUser | null;
  userProfile: User | null;
  isOnboarded: boolean;
  loading: boolean;
  refreshUserProfile: () => Promise<void>;
  /** Signal that signup writes are in progress — auth listener should defer profile fetch */
  setSignupInProgress: (v: boolean) => void;
  /** The referral code that was used to enter the app (from AsyncStorage) */
  validatedReferralCode: string | null;
}

export const AuthContext = createContext<AuthContextType>({
  user: null,
  userProfile: null,
  isOnboarded: false,
  loading: true,
  refreshUserProfile: async () => {},
  setSignupInProgress: () => {},
  validatedReferralCode: null,
});

export const useAuthContext = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuthContext must be used within AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [userProfile, setUserProfile] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [validatedReferralCode, setValidatedReferralCode] = useState<string | null>(null);
  const signupInProgressRef = useRef(false);

  const setSignupInProgress = (v: boolean) => {
    signupInProgressRef.current = v;
  };

  const fetchUserProfile = async (uid: string): Promise<User | null> => {
    try {
      const docRef = doc(db, 'users', uid);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (!data) return null;

        // Self-heal legacy broken photos: older onboarding saved a raw local
        // file:// URI that is unreadable from any other device. The original
        // image is unrecoverable server-side, so clear it (best-effort) and
        // treat it as empty locally so AvatarImage shows the clean fallback
        // instead of attempting a dead load. Only ever touch the signed-in
        // user's OWN doc — this function is only called with the current uid.
        let photoURL: string = data.photoURL ?? '';
        if (photoURL && !photoURL.startsWith('http')) {
          photoURL = '';
          try {
            await updateDoc(docRef, { photoURL: '' });
          } catch {
            // Non-fatal: a later open will retry the cleanup.
          }
        }

        return {
          id: docSnap.id,
          email: data.email,
          displayName: data.displayName,
          photoURL,
          bio: data.bio,
          location: data.location,
          locationName: data.locationName,
          pushToken: data.pushToken,
          pushTokens: data.pushTokens,
          isOnboarded: data.isOnboarded ?? false,
          createdAt: toDate(data.createdAt),
          updatedAt: toDate(data.updatedAt),
          rating: data.rating,
          reviewCount: data.reviewCount,
          // Referral & account lifecycle
          referredBy: data.referredBy,
          referralCode: data.referralCode ?? '',
          points: data.points ?? 0,
          accountStatus: data.accountStatus ?? 'pending_referral',
          conductAgreedAt: data.conductAgreedAt ? toDate(data.conductAgreedAt) : undefined,
          contractSignedAt: data.contractSignedAt ? toDate(data.contractSignedAt) : undefined,
          vettingScheduledAt: data.vettingScheduledAt ? toDate(data.vettingScheduledAt) : undefined,
          freeAccessUntil: data.freeAccessUntil ? toDate(data.freeAccessUntil) : undefined,
          instagramHandle: data.instagramHandle,
          hiddenReusePostIds: data?.hiddenReusePostIds ?? [],
          postTemplates: data?.postTemplates ?? [],
          // Written by the onPostCompleted Cloud Function; drives the mandatory
          // review gate. Mapped here so userProfile.pendingReview is reliable
          // for any consumer (the gate itself reads the live getDoc on open).
          pendingReview: data.pendingReview
            ? {
                postId: data.pendingReview.postId ?? '',
                role: data.pendingReview.role ?? 'owner',
                otherUserId: data.pendingReview.otherUserId ?? '',
                otherUserName: data.pendingReview.otherUserName ?? '',
                dogIds: data.pendingReview.dogIds ?? [],
                dogNames: data.pendingReview.dogNames ?? [],
                createdAt: toDate(data.pendingReview.createdAt),
              }
            : undefined,
        };
      }
      return null;
    } catch {
      return null;
    }
  };

  const refreshUserProfile = async () => {
    if (user) {
      const profile = await fetchUserProfile(user.uid);
      setUserProfile(profile);
    }
  };

  useEffect(() => {
    // Load the referral code from storage once
    AsyncStorage.getItem(REFERRAL_STORAGE_KEY)
      .then((val) => setValidatedReferralCode(val))
      .catch(() => setValidatedReferralCode(null));
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        // During signup, the user doc hasn't been written yet — skip fetch here.
        // signUp will call refreshUserProfile after the doc is created.
        if (!signupInProgressRef.current) {
          const profile = await fetchUserProfile(firebaseUser.uid);
          setUserProfile(profile);
        }
      } else {
        setUserProfile(null);
      }
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  const isOnboarded = userProfile?.isOnboarded ?? false;

  return (
    <AuthContext.Provider
      value={{ user, userProfile, isOnboarded, loading, refreshUserProfile, setSignupInProgress, validatedReferralCode }}
    >
      {children}
    </AuthContext.Provider>
  );
};
