import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import { initializeAuth, getAuth, Auth, getReactNativePersistence } from 'firebase/auth';
import { initializeFirestore, Firestore } from 'firebase/firestore';
import { getStorage, FirebaseStorage } from 'firebase/storage';
import AsyncStorage from '@react-native-async-storage/async-storage';

const firebaseConfig = {
  apiKey: 'AIzaSyBOF66WalEIXlKnowKip26mxkIAR4EfTpA',
  authDomain: 'swapdog-d0cfe.firebaseapp.com',
  projectId: 'swapdog-d0cfe',
  storageBucket: 'swapdog-d0cfe.firebasestorage.app',
  messagingSenderId: '523657483823',
  appId: '1:523657483823:web:ec8148ce28ee1e794b58da',
  measurementId: 'G-BQTEZZ5FP4',
};

const app: FirebaseApp = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
// Persist auth session to device storage (like Instagram — stays signed in)
const auth: Auth = getApps().length === 1
  ? initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) })
  : getAuth(app);
// initializeFirestore must be called before any other Firestore access on this app.
// ignoreUndefinedProperties: true silently drops undefined fields instead of throwing,
// fixing owner-role review writes where dogId/dogName/note may be undefined.
const db: Firestore = initializeFirestore(app, { ignoreUndefinedProperties: true });
const storage: FirebaseStorage = getStorage(app);

export { app, auth, db, storage };
