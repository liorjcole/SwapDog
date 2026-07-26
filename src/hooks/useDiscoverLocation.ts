import { useState, useEffect, useCallback, useRef } from 'react';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { GeoPoint } from '../models/types';

const STORAGE_KEY = '@swapdog:location_override';
const DEFAULT_LOCATION: GeoPoint = { latitude: 37.7749, longitude: -122.4194 };
const CURRENT_LOCATION_TIMEOUT_MS = 4500;
const LAST_KNOWN_MAX_AGE_MS = 15 * 60 * 1000;
const LAST_KNOWN_REQUIRED_ACCURACY_METERS = 5000;

export interface DiscoverLocation {
  coords: GeoPoint;
  isOverride: boolean;
  label?: string;
}

interface UseDiscoverLocationResult {
  location: DiscoverLocation | null;
  loading: boolean;
  error: string | null;
  setLocationOverride: (coords: GeoPoint, label?: string) => Promise<void>;
  clearLocationOverride: () => Promise<void>;
}

function toGeoPoint(position: Location.LocationObject): GeoPoint {
  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
  };
}

function resolveWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), timeoutMs);
    promise
      .then((value) => resolve(value))
      .catch(() => resolve(null))
      .finally(() => clearTimeout(timeout));
  });
}

export function useDiscoverLocation(
  profileLocation?: GeoPoint | null,
  profileLabel?: string | null,
): UseDiscoverLocationResult {
  const [location, setLocation] = useState<DiscoverLocation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const initSeqRef = useRef(0);
  const profileLat = profileLocation?.latitude;
  const profileLng = profileLocation?.longitude;

  const loadCurrentLocation = useCallback(async (): Promise<GeoPoint | null> => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setError('Location permission denied');
        return null;
      }

      const lastKnown = await Location.getLastKnownPositionAsync({
        maxAge: LAST_KNOWN_MAX_AGE_MS,
        requiredAccuracy: LAST_KNOWN_REQUIRED_ACCURACY_METERS,
      });
      if (lastKnown) return toGeoPoint(lastKnown);

      const pos = await resolveWithTimeout(
        Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Low,
          mayShowUserSettingsDialog: false,
        }),
        CURRENT_LOCATION_TIMEOUT_MS,
      );
      if (pos) return toGeoPoint(pos);

      setError('Unable to get current location');
      return null;
    } catch {
      setError('Unable to get current location');
      return null;
    }
  }, []);

  const init = useCallback(async () => {
    const seq = ++initSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      // Check for a stored override first
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (initSeqRef.current !== seq) return;
      if (stored) {
        const parsed = JSON.parse(stored) as { coords?: Partial<GeoPoint>; label?: string } | null;
        const latitude = parsed?.coords?.latitude;
        const longitude = parsed?.coords?.longitude;
        if (typeof latitude === 'number' && typeof longitude === 'number') {
          setLocation({ coords: { latitude, longitude }, isOverride: true, label: parsed?.label });
          setLoading(false);
          return;
        }
      }
    } catch {
      // Ignore storage errors
    }
    if (profileLat != null && profileLng != null) {
      setLocation({
        coords: { latitude: profileLat, longitude: profileLng },
        isOverride: false,
        label: profileLabel ?? undefined,
      });
      setLoading(false);
      return;
    }

    // Fall back to GPS
    const gps = await loadCurrentLocation();
    if (initSeqRef.current !== seq) return;
    if (gps) {
      setLocation({ coords: gps, isOverride: false });
    } else {
      // Ultimate fallback: San Francisco
      setLocation({ coords: DEFAULT_LOCATION, isOverride: false });
    }
    setLoading(false);
  }, [loadCurrentLocation, profileLat, profileLng, profileLabel]);

  useEffect(() => {
    void init();
  }, [init]);

  const setLocationOverride = useCallback(async (coords: GeoPoint, label?: string) => {
    initSeqRef.current += 1;
    const payload = JSON.stringify({ coords, label });
    await AsyncStorage.setItem(STORAGE_KEY, payload);
    setLocation({ coords, isOverride: true, label });
    setLoading(false);
  }, []);

  const clearLocationOverride = useCallback(async () => {
    const seq = ++initSeqRef.current;
    await AsyncStorage.removeItem(STORAGE_KEY);
    setLoading(true);
    const gps = await loadCurrentLocation();
    if (initSeqRef.current !== seq) return;
    const profileFallback = profileLat != null && profileLng != null
      ? { latitude: profileLat, longitude: profileLng }
      : null;
    setLocation(
      gps
        ? { coords: gps, isOverride: false }
        : profileFallback
          ? { coords: profileFallback, isOverride: false, label: profileLabel ?? undefined }
          : { coords: DEFAULT_LOCATION, isOverride: false },
    );
    setLoading(false);
  }, [loadCurrentLocation, profileLat, profileLng, profileLabel]);

  return { location, loading, error, setLocationOverride, clearLocationOverride };
}
