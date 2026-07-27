import {
  placeDetailsSecure,
  placesAutocompleteSecure,
} from '../services/secureOperations';

export interface Prediction {
  placeId: string;
  description: string;
}

export interface PlaceDetail {
  formattedAddress: string;
  city: string;
  lat: number;
  lng: number;
}

export function newSessionToken(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export async function placesAutocomplete(
  input: string,
  sessionToken: string,
): Promise<Prediction[]> {
  if (input.trim().length < 2) return [];
  try {
    const result = await placesAutocompleteSecure(input.trim(), sessionToken);
    return result.predictions;
  } catch {
    return [];
  }
}

export async function placeDetails(
  placeId: string,
  sessionToken: string,
): Promise<PlaceDetail | null> {
  try {
    return await placeDetailsSecure(placeId, sessionToken);
  } catch {
    return null;
  }
}
