/**
 * Google Places REST utilities — shared across all address-entry surfaces.
 *
 * Reads the API key from expo-constants (injected via app.config.js +
 * EAS secret GOOGLE_PLACES_API_KEY). Never hard-codes a key value.
 *
 * Session-token discipline: generate one token per typing session
 * (`newSessionToken()`), pass it to every autocomplete call, then pass the
 * SAME token to `placeDetails` to close the session — Google bills the
 * entire round-trip as a single lookup.  Mint a fresh token after each
 * selection or modal-dismiss.
 */

import Constants from 'expo-constants';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Prediction {
  placeId: string;
  description: string;
}

export interface PlaceDetail {
  formattedAddress: string;
  /** City / locality extracted from address_components. */
  city: string;
  lat: number;
  lng: number;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

const BASE = 'https://maps.googleapis.com/maps/api/place';

/** Reads the Places API key from Expo config.  Returns '' if absent. */
function apiKey(): string {
  return (Constants.expoConfig?.extra?.googlePlacesApiKey as string | undefined) ?? '';
}

// Suppress repeated console warnings when the key is absent (e.g. local dev
// builds before the EAS secret is set).
let _keyMissingWarned = false;
function warnKeyMissing(): void {
  if (!_keyMissingWarned) {
    console.warn('[googlePlaces] API key not configured — autocomplete disabled. ' +
      'Set EAS secret GOOGLE_PLACES_API_KEY and rebuild.');
    _keyMissingWarned = true;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Generate a fresh session token.  One token must cover a complete
 * autocomplete → place-details sequence; call again after each selection.
 */
export function newSessionToken(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/**
 * Fetch autocomplete predictions from the Google Places API.
 * Returns `[]` on missing key, network failure, non-OK status, or empty list.
 */
export async function placesAutocomplete(
  input: string,
  sessionToken: string,
): Promise<Prediction[]> {
  if (input.trim().length < 2) return [];

  const key = apiKey();
  if (!key) {
    warnKeyMissing();
    return [];
  }

  try {
    const url =
      `${BASE}/autocomplete/json` +
      `?input=${encodeURIComponent(input)}` +
      `&key=${encodeURIComponent(key)}` +
      `&sessiontoken=${encodeURIComponent(sessionToken)}` +
      `&components=country:us%7Ccountry:ca` +
      `&language=en`;

    const response = await fetch(url);
    if (!response || !response.ok) {
      console.warn(
        `[googlePlaces] Autocomplete failed: HTTP ${response?.status ?? 'no response'}`,
      );
      return [];
    }

    const data = (await response.json()) as {
      status?: string;
      predictions?: Array<{ place_id?: string; description?: string }>;
    };

    if (!data?.predictions || data.predictions.length === 0) return [];

    return data.predictions
      .filter((p) => typeof p.place_id === 'string' && typeof p.description === 'string')
      .map((p) => ({ placeId: p.place_id!, description: p.description! }));
  } catch {
    return [];
  }
}

/**
 * Fetch place details (geometry + formatted address) for the given placeId.
 * Returns `null` on missing key, network failure, non-OK status, or absent geometry.
 */
export async function placeDetails(
  placeId: string,
  sessionToken: string,
): Promise<PlaceDetail | null> {
  const key = apiKey();
  if (!key) return null;

  try {
    const url =
      `${BASE}/details/json` +
      `?place_id=${encodeURIComponent(placeId)}` +
      `&key=${encodeURIComponent(key)}` +
      `&sessiontoken=${encodeURIComponent(sessionToken)}` +
      `&fields=formatted_address%2Cgeometry%2Caddress_components`;

    const response = await fetch(url);
    if (!response || !response.ok) {
      console.warn(
        `[googlePlaces] Place details failed: HTTP ${response?.status ?? 'no response'}`,
      );
      return null;
    }

    const data = (await response.json()) as {
      result?: {
        formatted_address?: string;
        geometry?: { location?: { lat?: number; lng?: number } };
        address_components?: Array<{ long_name?: string; types?: string[] }>;
      };
    };

    if (!data?.result) return null;

    const location = data.result.geometry?.location;
    if (!location) return null;

    // Prefer locality (city); fall back to sublocality (e.g. Brooklyn).
    const cityComponent = data.result.address_components?.find(
      (c) =>
        Array.isArray(c.types) &&
        (c.types.includes('locality') || c.types.includes('sublocality')),
    );

    return {
      formattedAddress: data.result.formatted_address ?? '',
      city: cityComponent?.long_name ?? '',
      lat: location.lat ?? 0,
      lng: location.lng ?? 0,
    };
  } catch {
    return null;
  }
}

