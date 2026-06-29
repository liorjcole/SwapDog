import { doc, getDoc } from 'firebase/firestore';
import { db } from '../config/firebase';

/**
 * Resolve the current primary photo URL for a dog from the live
 * dogs/{dogId} document. Falls back to `fallback` when the live read yields
 * nothing (network error, missing doc, or no photoURLs stored).
 *
 * Why: Storage tokens rotate whenever a dog photo is re-uploaded. The
 * denormalized `post.dogPhotoURLs[i]` goes stale at that point and renders
 * as a blank image. Reading the dogs collection directly always returns the
 * current token.
 */
export const resolveDogPhotoURL = async (
  dogId: string,
  fallback = '',
): Promise<string> => {
  try {
    const snap = await getDoc(doc(db, 'dogs', dogId));
    const data = snap.data();
    if (!data) return fallback;
    const urls = data.photoURLs as string[] | undefined;
    return urls?.[0] ?? fallback;
  } catch {
    return fallback;
  }
};

/**
 * Batch-resolve live primary photo URLs for multiple dogs in parallel.
 * Index-aligned with dogIds: resolveDogPhotos(['id1','id2'], ['fb1','fb2'])
 * returns ['liveUrl1', 'liveUrl2'].
 *
 * Individual failures fall back to the corresponding element in `fallbacks`
 * (or empty string when no fallback is provided).
 */
export const resolveDogPhotos = async (
  dogIds: string[],
  fallbacks: string[] = [],
): Promise<string[]> =>
  Promise.all(dogIds.map((id, i) => resolveDogPhotoURL(id, fallbacks[i] ?? '')));

