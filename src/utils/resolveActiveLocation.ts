import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { GeoPoint, User } from '../models/types';

/**
 * AsyncStorage key written by the Discover "Change Location" flow.
 * Must stay identical to useDiscoverLocation's STORAGE_KEY.
 */
const LOCATION_OVERRIDE_KEY = '@swapdog:location_override';

export interface ResolvedLocation {
  coords: GeoPoint;
  /** Full location label, e.g. "Montreal, Quebec, Canada" (override / onboarding only). */
  label?: string;
}

/**
 * Resolves the user's active location using the same priority the Discover feed
 * honors, so a new post is stamped with the user's "Change Location" choice
 * rather than raw device GPS.
 *
 * Priority:
 *   1. AsyncStorage override (`@swapdog:location_override`) — the "Change Location" pick.
 *   2. userProfile.location / locationName — onboarding GPS persisted to Firestore.
 *   3. Device GPS — last-resort fallback.
 *
 * Every async read is guarded; returns null only when all three sources fail.
 */
export async function resolveActiveLocation(
  userProfile?: Pick<User, 'location' | 'locationName'> | null,
): Promise<ResolvedLocation | null> {
  // 1. "Change Location" override (device-local, persists across restarts).
  try {
    const stored = await AsyncStorage.getItem(LOCATION_OVERRIDE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as { coords?: GeoPoint; label?: string } | null;
      if (parsed?.coords) {
        return { coords: parsed.coords, label: parsed.label };
      }
    }
  } catch {
    // Ignore storage/parse errors — fall through to the next source.
  }

  // 2. Onboarding location persisted to the Firestore user doc.
  if (userProfile?.location) {
    return { coords: userProfile.location, label: userProfile.locationName };
  }

  // 3. Last-resort device GPS.
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status === 'granted') {
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      return { coords: { latitude: pos.coords.latitude, longitude: pos.coords.longitude } };
    }
  } catch {
    // Ignore — no location available.
  }

  return null;
}

