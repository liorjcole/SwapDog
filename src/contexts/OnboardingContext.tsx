import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { DogSex, EnergyLevel } from '../models/types';

// ─── Dog form shape ───
export interface DogForm {
  name: string;
  breed: string;
  ageYears: number;
  ageMonths: number;
  weightLbs: number;
  sex: DogSex;
  energy: EnergyLevel;
  goodWithDogs: boolean;
  goodWithKids: boolean;
  vaccinated: boolean;
  pottyTrained: boolean;
  photoURLs: string[];
  dogBio: string;
}

export const blankDogForm = (): DogForm => ({
  name: '',
  breed: '',
  ageYears: 0,
  ageMonths: 1,
  weightLbs: 0,
  sex: DogSex.male,
  energy: EnergyLevel.moderate,
  goodWithDogs: false,
  goodWithKids: false,
  vaccinated: false,
  pottyTrained: false,
  photoURLs: [],
  dogBio: '',
});

// ─── Saved dog record ───
export interface SavedDog {
  id?: string;
  name: string;
  breed: string;
  photoURL?: string;
  formSnapshot?: DogForm;
}

// ─── Full onboarding state ───
interface OnboardingState {
  // Profile
  displayName: string;
  bio: string;
  instagramHandle: string;
  photoURL: string;

  // Current dog form (in-progress)
  dogForm: DogForm;
  currentDogId: string | null;

  // Dogs already saved to Firestore this session
  savedDogs: SavedDog[];
  savedCount: number;

  // Location
  locationName: string | null;
}

interface OnboardingContextType extends OnboardingState {
  setDisplayName: (v: string) => void;
  setBio: (v: string) => void;
  setInstagramHandle: (v: string) => void;
  setPhotoURL: (v: string) => void;
  setDogForm: (v: DogForm) => void;
  setCurrentDogId: (v: string | null) => void;
  updateDogForm: <K extends keyof DogForm>(key: K, value: DogForm[K]) => void;
  resetDogForm: () => void;
  addSavedDog: (dog: SavedDog) => void;
  removeSavedDog: (id: string) => void;
  popLastSavedDog: () => SavedDog | null;
  setLocationName: (v: string | null) => void;
  resetAll: () => void;
}

const OnboardingContext = createContext<OnboardingContextType | null>(null);

export const OnboardingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [instagramHandle, setInstagramHandle] = useState('');
  const [photoURL, setPhotoURL] = useState('');
  const [dogForm, setDogForm] = useState<DogForm>(blankDogForm());
  const [savedDogs, setSavedDogs] = useState<SavedDog[]>([]);
  const savedDogsRef = useRef<SavedDog[]>([]);
  const [currentDogId, setCurrentDogId] = useState<string | null>(null);
  const savedCount = savedDogs.length;
  const [locationName, setLocationName] = useState<string | null>(null);

  const updateDogForm = useCallback(<K extends keyof DogForm>(key: K, value: DogForm[K]) => {
    setDogForm((f) => ({ ...f, [key]: value }));
  }, []);

  const resetDogForm = useCallback(() => {
    setDogForm(blankDogForm());
    setCurrentDogId(null);
  }, []);

  const addSavedDog = useCallback((dog: SavedDog) => {
    const next = [...savedDogsRef.current, dog];
    savedDogsRef.current = next;
    setSavedDogs(next);
  }, []);

  const popLastSavedDog = useCallback((): SavedDog | null => {
    const current = savedDogsRef.current;
    if (current.length === 0) return null;

    const popped = current[current.length - 1];
    const next = current.slice(0, -1);
    savedDogsRef.current = next;
    setSavedDogs(next);

    if (popped.formSnapshot) {
      setDogForm({
        ...popped.formSnapshot,
        photoURLs: [...popped.formSnapshot.photoURLs],
      });
    }
    setCurrentDogId(popped.id ?? null);
    return popped;
  }, []);

  const removeSavedDog = useCallback((id: string) => {
    const next = savedDogsRef.current.filter((d) => d.id !== id);
    savedDogsRef.current = next;
    setSavedDogs(next);
  }, []);

  const resetAll = useCallback(() => {
    setDisplayName('');
    setBio('');
    setInstagramHandle('');
    setPhotoURL('');
    setDogForm(blankDogForm());
    setCurrentDogId(null);
    savedDogsRef.current = [];
    setSavedDogs([]);
    setLocationName(null);
  }, []);

  return (
    <OnboardingContext.Provider
      value={{
        displayName, setDisplayName,
        bio, setBio,
        instagramHandle, setInstagramHandle,
        photoURL, setPhotoURL,
        dogForm, setDogForm, currentDogId, setCurrentDogId, updateDogForm, resetDogForm,
        savedDogs, savedCount, addSavedDog, removeSavedDog, popLastSavedDog,
        locationName, setLocationName,
        resetAll,
      }}
    >
      {children}
    </OnboardingContext.Provider>
  );
};

export const useOnboarding = (): OnboardingContextType => {
  const ctx = useContext(OnboardingContext);
  if (!ctx) throw new Error('useOnboarding must be used within OnboardingProvider');
  return ctx;
};
