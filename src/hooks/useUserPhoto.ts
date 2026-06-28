import { useEffect, useState } from 'react';
import { useUsers } from './useUsers';

/**
 * Single source of truth for owner/poster identity photos.
 *
 * Identity photos must always resolve from the live `users/{uid}` doc — never
 * from a frozen denormalized snapshot (e.g. `post.posterPhotoURL`), which goes
 * stale when the user changes their photo and breaks when Storage rotates the
 * download token on overwrite. The denormalized snapshot is accepted only as an
 * instant placeholder for zero-flash paint; the live value wins once fetched.
 *
 * Backed by a module-level cache (keyed by uid) so repeated renders across the
 * app share one fetch, and an in-flight map so concurrent mounts de-dupe to a
 * single network read. A short TTL means a user who just changed their photo
 * sees it everywhere on the next view.
 */

interface CacheEntry {
  photoURL: string | undefined;
  fetchedAt: number;
}

type FetchResult = { ok: true; photoURL: string | undefined } | { ok: false };

// 5 minutes — fresh enough that a just-changed photo propagates app-wide, long
// enough to dedupe the common burst of renders for the same user.
const PHOTO_TTL_MS = 5 * 60 * 1000;

const photoCache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<FetchResult>>();

const isFresh = (entry: CacheEntry | undefined): entry is CacheEntry =>
  entry != null && Date.now() - entry.fetchedAt < PHOTO_TTL_MS;

export interface UserPhotoResult {
  /** Live photo once resolved; the placeholder until then. May be undefined. */
  photoURL: string | undefined;
  /** True while the live value is still being fetched. */
  loading: boolean;
}

export const useUserPhoto = (uid?: string, placeholder?: string): UserPhotoResult => {
  const { getUser } = useUsers();

  const initialEntry = uid ? photoCache.get(uid) : undefined;
  const initialFresh = isFresh(initialEntry);

  const [resolved, setResolved] = useState<string | undefined>(
    initialFresh && initialEntry ? initialEntry.photoURL : undefined,
  );
  const [hasResolved, setHasResolved] = useState<boolean>(initialFresh);
  const [loading, setLoading] = useState<boolean>(!!uid && !initialFresh);

  useEffect(() => {
    if (!uid) {
      setResolved(undefined);
      setHasResolved(false);
      setLoading(false);
      return;
    }

    const entry = photoCache.get(uid);
    if (isFresh(entry)) {
      setResolved(entry.photoURL);
      setHasResolved(true);
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);

    // Share one network read across every hook instance for this uid.
    let request = inFlight.get(uid);
    if (!request) {
      request = getUser(uid)
        .then((user): FetchResult => {
          const photoURL = user?.photoURL ?? undefined;
          photoCache.set(uid, { photoURL, fetchedAt: Date.now() });
          return { ok: true, photoURL };
        })
        .catch((err): FetchResult => {
          console.error('[useUserPhoto] getUser failed:', err);
          return { ok: false };
        })
        .finally(() => {
          inFlight.delete(uid);
        });
      inFlight.set(uid, request);
    }

    void request.then((result) => {
      if (!active) return;
      // Only the live value wins. On failure keep the placeholder rather than
      // flipping to the empty/emoji state for a transient blip.
      if (result.ok) {
        setResolved(result.photoURL);
        setHasResolved(true);
      }
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [uid, getUser]);

  return {
    photoURL: hasResolved ? resolved : placeholder,
    loading,
  };
};

