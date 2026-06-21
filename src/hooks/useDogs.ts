import {
  doc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  collection,
  query,
  where,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../config/firebase';
import { Dog, DogSize, DogSex, EnergyLevel } from '../models/types';
import { toDate } from '../utils/firestoreConverters';

const parseDog = (id: string, data: Record<string, unknown>): Dog => {
  // Backward-compat: legacy `age` (single number) → ageYears, ageMonths=0
  const legacyAge = data.age as number | undefined;
  const ageYears = data.ageYears !== undefined ? (data.ageYears as number) : (legacyAge ?? 0);
  const ageMonths = data.ageMonths !== undefined ? (data.ageMonths as number) : 0;

  // Backward-compat: legacy `photos` array → photoURLs
  const legacyPhotos = data.photos as string[] | undefined;
  const photoURLs: string[] =
    data.photoURLs !== undefined
      ? (data.photoURLs as string[])
      : legacyPhotos ?? [];

  return {
    id,
    ownerId: data.ownerId as string,
    name: data.name as string,
    breed: data.breed as string,
    ageYears,
    ageMonths,
    size: data.size as DogSize,
    weightLbs: (data.weightLbs as number | undefined) ?? undefined,
    sex: data.sex as DogSex,
    energyLevel: data.energyLevel as EnergyLevel,
    photoURLs,
    bio: data.bio as string | undefined,
    isGoodWithDogs: data.isGoodWithDogs as boolean | undefined,
    isGoodWithKids: data.isGoodWithKids as boolean | undefined,
    isSpayedNeutered: data.isSpayedNeutered as boolean | undefined,
    vaccinated: data.vaccinated as boolean | undefined,
    temperament: data.temperament as string | undefined,
    createdAt: toDate(data.createdAt as Parameters<typeof toDate>[0]),
    updatedAt: toDate(data.updatedAt as Parameters<typeof toDate>[0]),
  };
};

export const useDogs = () => {
  const getDog = async (id: string): Promise<Dog | null> => {
    const snap = await getDoc(doc(db, 'dogs', id));
    if (!snap.exists()) return null;
    return parseDog(snap.id, snap.data() as Record<string, unknown>);
  };

  const getDogsByOwner = async (ownerId: string): Promise<Dog[]> => {
    const q = query(collection(db, 'dogs'), where('ownerId', '==', ownerId));
    const snap = await getDocs(q);
    return snap.docs.map((d) => parseDog(d.id, d.data() as Record<string, unknown>));
  };

  const createDog = async (data: Omit<Dog, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> => {
    const ref = await addDoc(collection(db, 'dogs'), {
      ...data,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return ref.id;
  };

  const updateDog = async (id: string, data: Partial<Dog>): Promise<void> => {
    await updateDoc(doc(db, 'dogs', id), { ...data, updatedAt: serverTimestamp() });
  };

  const deleteDog = async (id: string): Promise<void> => {
    await deleteDoc(doc(db, 'dogs', id));
  };

  return { getDog, getDogsByOwner, createDog, updateDog, deleteDog };
};
