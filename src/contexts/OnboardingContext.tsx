import React, { createContext, useContext, useState, useCallback } from 'react';
import { DogSize, DogSex, EnergyLevel } from '../models/types';

// ─── Dog form shape ───
export interface DogForm {
  name: string;
  breed: string;
  ageYears: number;
  ageMonths: number;
  weightLbs: number;
  size: DogSize;
  sex: DogSex;
  energy: EnergyLevel;
  goodWithDogs: boolean;
  goodWithKids: boolean;
  vaccinated: boolean;
  photoURLs: string[];
}

export const blankDogForm = (): DogForm => ({
  name: '',
  breed: '',
  ageYears: 0,
  ageMonths: 1,
  weightLbs: 0,
  size: DogSize.medium,
  sex: DogSex.male,
  energy: EnergyLevel.moderate,
  goodWithDogs: false,
  goodWithKids: false,
  vaccinated: false,
  photoURLs: [],
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
  const [savedCount, setSavedCount] = useState(0);
  const [locationName, setLocationName] = useState<string | null>(null);

  const updateDogForm = useCallback(<K extends keyof DogForm>(key: K, value: DogForm[K]) => {
    setDogForm((f) => ({ ...f, [key]: value }));
  }, []);

  const resetDogForm = useCallback(() => setDogForm(blankDogForm()), []);

  const addSavedDog = useCallback((dog: SavedDog) => {
    setSavedDogs((prev) => [...prev, dog]);
    setSavedCount((c) => c + 1);
  }, []);

  const popLastSavedDog = useCallback((): SavedDog | null => {
    const last = savedDogs[savedDogs.length - 1];
    if (!last) return null;
    setSavedDogs((prev) => prev.slice(0, -1));
    // Restore the form to the popped dog's snapshot
    if (last.formSnapshot) {
      setDogForm(last.formSnapshot);
    }
    return last;
  }, [savedDogs]);

  const removeSavedDog = useCallback((id: string) => {
    setSavedDogs((prev) => prev.filter((d) => d.id !== id));
    setSavedCount((c) => Math.max(0, c - 1));
  }, []);

  const resetAll = useCallback(() => {
    setDisplayName('');
    setBio('');
    setInstagramHandle('');
    setPhotoURL('');
    setDogForm(blankDogForm());
    setSavedDogs([]);
    setSavedCount(0);
    setLocationName(null);
  }, []);

  return (
    <OnboardingContext.Provider
      value={{
        displayName, setDisplayName,
        bio, setBio,
        instagramHandle, setInstagramHandle,
        photoURL, setPhotoURL,
        dogForm, setDogForm, updateDogForm, resetDogForm,
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
