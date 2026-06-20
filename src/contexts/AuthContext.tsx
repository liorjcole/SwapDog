import React, { createContext, useContext, useEffect, useState, useRef, ReactNode } from 'react';
import { User as FirebaseUser, onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { auth, db } from '../config/firebase';
import { User } from '../models/types';
import { toDate } from '../utils/firestoreConverters';
import { REFERRAL_STORAGE_KEY } from '../screens/auth/ReferralCodeScreen';


const ADMIN_UID = '5SUwrjPWPzbqf7qTYRS74Uj7CB82';
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
        return {
          id: docSnap.id,
          email: data.email,
          displayName: data.displayName,
          photoURL: data.photoURL,
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
          instagramHandle: data.instagramHandle,
          isAdmin: docSnap.id === ADMIN_UID || data.role === 'admin',
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
