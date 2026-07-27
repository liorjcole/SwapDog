import {
  collection,
  getDocs,
  getDoc,
  updateDoc,
  doc,
  query,
  QueryConstraint,
  where,
  orderBy,
  startAt,
  endAt,
  serverTimestamp,
  or,
  arrayUnion,
} from 'firebase/firestore';
import { geohashQueryBounds } from 'geofire-common';
import { db } from '../config/firebase';
import {
  SwapRequest,
  SwapStatus,
  PaymentType,
  SitterPreference,
  SwapPost,
  PostStatus,
  PostTemplate,
} from '../models/types';
import { toDate } from '../utils/firestoreConverters';
import {
  addPostResponseSecure,
  approvePostHelperSecure,
  cancelCommitmentSecure,
  createPostSecure,
  createSwapRequestSecure,
  removePostResponseSecure,
  respondToPostCounterSecure,
} from '../services/secureOperations';

// ─── Legacy SwapRequest parser ────────────────────────────────────────────────
const parseSwap = (id: string, data: Record<string, unknown>): SwapRequest => ({
  id,
  requesterId: data.requesterId as string,
  receiverId: data.receiverId as string,
  requesterDogIds: (data.requesterDogIds as string[]) ?? [],
  receiverDogIds: (data.receiverDogIds as string[]) ?? [],
  startDate: toDate(data.startDate as Parameters<typeof toDate>[0]),
  endDate: toDate(data.endDate as Parameters<typeof toDate>[0]),
  message: data.message as string | undefined,
  careDetails: data.careDetails as string | undefined,
  status: data.status as SwapStatus,
  conversationId: data.conversationId as string | undefined,
  pointsCost: (data.pointsCost as number) ?? 1,
  paymentOffered: data.paymentOffered as number | undefined,
  paymentType: ((data.paymentType as PaymentType) ?? 'points'),
  sitterPreference: data.sitterPreference as SitterPreference | undefined,
  createdAt: toDate(data.createdAt as Parameters<typeof toDate>[0]),
  updatedAt: toDate(data.updatedAt as Parameters<typeof toDate>[0]),
});

// ─── SwapPost parser ──────────────────────────────────────────────────────────
export const parsePost = (id: string, data: Record<string, unknown>): SwapPost => ({
  id,
  posterId: data.posterId as string,
  posterName: data.posterName as string,
  posterPhotoURL: data.posterPhotoURL as string | undefined,
  posterLocation: data.posterLocation as { latitude: number; longitude: number } | undefined,
  posterGeohash: data.posterGeohash as string | undefined,
  posterLocationName: data.posterLocationName as string | undefined,
  dogId: data.dogId as string,
  dogName: data.dogName as string,
  dogBreed: data.dogBreed as string | undefined,
  dogPhotoURL: data.dogPhotoURL as string | undefined,
  // Multi-dog fields (optional, new)
  dogIds: data.dogIds as string[] | undefined,
  dogNames: data.dogNames as string[] | undefined,
  dogBreeds: data.dogBreeds as string[] | undefined,
  dogPhotoURLs: data.dogPhotoURLs as string[] | undefined,
  startDate: toDate(data.startDate as Parameters<typeof toDate>[0]),
  endDate: toDate(data.endDate as Parameters<typeof toDate>[0]),
  careDetails: data.careDetails as string,
  carePhotos: data.carePhotos as string[] | undefined,
  compensationType: (data.compensationType as SwapPost['compensationType']) ?? 'points',
  pointsCost: (data.pointsCost as number) ?? 1,
  paymentAmount: data.paymentAmount as number | undefined,
  paymentRate: data.paymentRate as SwapPost['paymentRate'],
  totalPayment: data.totalPayment as number | undefined,
  totalUnits: data.totalUnits as number | undefined,
  pointsDisabled: data.pointsDisabled as boolean | undefined,
  status: (data.status as PostStatus) ?? 'open',
  claimedBy: data.claimedBy as string | undefined,
  lateCancelled: data.lateCancelled as boolean | undefined,
  lateCancelledBy: data.lateCancelledBy as 'owner' | 'sitter' | undefined,
  rescheduleProposedStart: data.rescheduleProposedStart ? toDate(data.rescheduleProposedStart as Parameters<typeof toDate>[0]) : undefined,
  rescheduleProposedEnd: data.rescheduleProposedEnd ? toDate(data.rescheduleProposedEnd as Parameters<typeof toDate>[0]) : undefined,
  rescheduleNote: data.rescheduleNote as string | undefined,
  rescheduleProposedBy: data.rescheduleProposedBy as string | undefined,
  respondedBy: (() => {
    const raw = data.respondedBy as Record<string, unknown>[] | undefined;
    if (!raw) return undefined;
    return raw.map((r) => ({
      userId: r.userId as string,
      userName: r.userName as string,
      userPhotoURL: r.userPhotoURL as string | undefined,
      respondedAt: toDate(r.respondedAt as Parameters<typeof toDate>[0]),
      counterPoints: r.counterPoints as number | undefined,
      counterStatus: r.counterStatus as 'pending' | 'accepted' | 'declined' | undefined,
    }));
  })(),
  reminderNotificationIds: (data.reminderNotificationIds as string[] | undefined) ?? undefined,
  sitterReminderNotificationIds: (data.sitterReminderNotificationIds as string[] | undefined) ?? undefined,
  // Wave 19B care type fields
  careType: data.careType as SwapPost['careType'],
  pointsOffered: data.pointsOffered as number | undefined,
  walkDurationMinutes: data.walkDurationMinutes as number | undefined,
  feedingTime: data.feedingTime as string | undefined,
  startTime: data.startTime as string | undefined,
  endTime: data.endTime as string | undefined,
  // Add-on care detail fields
  addOnCareTypes: data.addOnCareTypes as string[] | undefined,
  // Reuse-prefill fields (written by createPost; previously dropped on read)
  careAddress: data?.careAddress as string | undefined,
  overnightLocation: data?.overnightLocation as SwapPost['overnightLocation'],
  sitterTransport: data?.sitterTransport as SwapPost['sitterTransport'],
  walkSessions: data.walkSessions as SwapPost['walkSessions'],
  walkDurationMins: data.walkDurationMins as number | undefined,
  feedingSlots: data.feedingSlots as SwapPost['feedingSlots'],
  playSessions: data.playSessions as SwapPost['playSessions'],
  medicationSlots: data.medicationSlots as SwapPost['medicationSlots'],
  createdAt: toDate(data.createdAt as Parameters<typeof toDate>[0]),
  updatedAt: toDate(data.updatedAt as Parameters<typeof toDate>[0]),
});

// ─── Distance helper (Haversine) ──────────────────────────────────────────────
export function distanceMiles(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const R = 3958.8; // Earth radius in miles
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export const useSwaps = () => {
  // ── Legacy SwapRequest ops (kept for old records) ─────────────────────────
  const createSwap = async (
    data: Omit<SwapRequest, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<string> => {
    const result = await createSwapRequestSecure(data);
    return result.swapRequestId;
  };

  const getSwapsByUser = async (userId: string): Promise<SwapRequest[]> => {
    const q = query(
      collection(db, 'swapRequests'),
      or(where('requesterId', '==', userId), where('receiverId', '==', userId))
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => parseSwap(d.id, d.data() as Record<string, unknown>));
  };

  // ── NEW: Public post ops ──────────────────────────────────────────────────

  /** Create a new public post visible to everyone in the poster's area */
  const createPost = async (
    data: Omit<SwapPost, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<string> => {
    const result = await createPostSecure(data);
    return result.postId;
  };

  /** Check if a post's end date/time has passed.
   * @param graceSecs - extra seconds after end time before the post is considered expired (default 0).
   *   Pass 60 for claimed posts to implement the ~1-minute-after-end-time drop from Discover.
   */
  const isPostExpired = (post: SwapPost, graceSecs = 0): boolean => {
    const now = new Date();
    const end = new Date(post.endDate);
    // Combine endDate with endTime if available
    if (post.endTime) {
      const match = post.endTime.match(/(\d+):(\d+)\s*(AM|PM)/i);
      if (match) {
        let h = parseInt(match[1], 10);
        const m = parseInt(match[2], 10);
        if (match[3].toUpperCase() === 'PM' && h !== 12) h += 12;
        if (match[3].toUpperCase() === 'AM' && h === 12) h = 0;
        end.setHours(h, m, 0, 0);
      }
    } else {
      // No end time — expire at end of day
      end.setHours(23, 59, 59, 999);
    }
    return now > new Date(end.getTime() + graceSecs * 1_000);
  };

  /**
   * Returns true when a post's start moment has passed with no confirmed helper.
   * Used to hide unclaimed posts from Discover and move them to Archive in My Posts.
   *
   * - claimedBy set → helper confirmed, always false (keep post alive).
   * - startTime present → cutoff = startDate@startTime + 60 s (1-minute grace).
   * - startTime absent → cutoff = end-of-startDate day (23:59:59.999, so a
   *   date-only post stays visible all day and expires only once the day is over).
   */
  const isStartExpiredNoHelper = (post: SwapPost): boolean => {
    if (post.claimedBy) return false; // confirmed helper — keep the post alive
    const now = new Date();
    const start = new Date(post.startDate ?? new Date());
    if (post.startTime) {
      const match = post.startTime.match(/(\d+):(\d+)\s*(AM|PM)/i);
      if (match) {
        let h = parseInt(match[1], 10);
        const m = parseInt(match[2], 10);
        if (match[3].toUpperCase() === 'PM' && h !== 12) h += 12;
        if (match[3].toUpperCase() === 'AM' && h === 12) h = 0;
        start.setHours(h, m, 0, 0);
      }
      // 1-minute grace period after the posted start time
      return now > new Date(start.getTime() + 60_000);
    }
    // Date-only post: expire after the start day is fully over
    start.setHours(23, 59, 59, 999);
    return now > start;
  };

  /** Fetch all area posts (open + claimed) for the Discover feed, filtered by distance and expiry. */
  const getAreaPosts = async (
    location?: { latitude: number; longitude: number },
    radiusMiles = 25
  ): Promise<SwapPost[]> => {
    const baseConstraints: QueryConstraint[] = [where('status', 'in', ['open', 'claimed'])];

    const snaps = location
      ? await Promise.all(
          geohashQueryBounds(
            [location.latitude, location.longitude],
            radiusMiles * 1609.344,
          ).map(([start, end]) =>
            getDocs(query(
              collection(db, 'publicSwapPosts'),
              ...baseConstraints,
              orderBy('posterGeohash'),
              startAt(start),
              endAt(end),
            )),
          ),
        )
      : [await getDocs(query(collection(db, 'publicSwapPosts'), ...baseConstraints))];

    const seen = new Set<string>();
    const all = snaps.flatMap((snap) => snap.docs)
      .filter((d) => {
        if (seen.has(d.id)) return false;
        seen.add(d.id);
        return true;
      })
      .map((d) => parsePost(d.id, d.data() as Record<string, unknown>))
      .filter((p) => {
        if (p.status === 'claimed') {
          // Drop claimed posts ~1 min after their event ends (display-only; Firestore status unchanged)
          return !isPostExpired(p, 60) && !p.pointsDisabled;
        }
        return (
          p.status === 'open' &&
          !isPostExpired(p) &&
          !isStartExpiredNoHelper(p) && // exclude start-expired posts with no helper
          !p.pointsDisabled
        );
      }); // keep open + claimed; exclude completed/expired/cancelled/points-disabled

    if (!location) return all;

    return all.filter((p) => {
      if (!p.posterLocation) return false;
      return (
        distanceMiles(
          location.latitude, location.longitude,
          p.posterLocation.latitude, p.posterLocation.longitude
        ) <= radiusMiles
      );
    });
  };

  /** Fetch all posts by a specific user (for "My Posts" section) */
  const getMyPosts = async (userId: string): Promise<SwapPost[]> => {
    const q = query(
      collection(db, 'swapPosts'),
      where('posterId', '==', userId)
    );
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => parsePost(d.id, d.data() as Record<string, unknown>))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  };

  /**
   * Permanently hide a post from the user's "Reuse a past request" list.
   * Writes the post id to users/{uid}.hiddenReusePostIds via arrayUnion.
   * Hiding is permanent (never arrayRemove) and does NOT delete the post.
   */
  const hidePostFromReuse = async (userId: string, postId: string): Promise<void> => {
    await updateDoc(doc(db, 'users', userId), {
      hiddenReusePostIds: arrayUnion(postId),
      updatedAt: serverTimestamp(),
    });
  };

  /**
   * Append a new opt-in saved template to users/{uid}.postTemplates.
   * arrayUnion is safe for add (new objects are always unique).
   */
  const addPostTemplate = async (uid: string, t: PostTemplate): Promise<void> => {
    await updateDoc(doc(db, 'users', uid), {
      postTemplates: arrayUnion(t),
      updatedAt: serverTimestamp(),
    });
  };

  /**
   * Replace the template with matching id. Firestore can't patch one array
   * element by id, so read-modify-write the whole array from the in-memory list.
   */
  const updatePostTemplate = async (uid: string, current: PostTemplate[], t: PostTemplate): Promise<void> => {
    const next = (current ?? []).map(x => (x?.id === t.id ? t : x));
    await updateDoc(doc(db, 'users', uid), {
      postTemplates: next,
      updatedAt: serverTimestamp(),
    });
  };

  /** Remove a saved template by id via read-modify-write (filter out). */
  const removePostTemplate = async (uid: string, current: PostTemplate[], id: string): Promise<void> => {
    const next = (current ?? []).filter(x => x?.id !== id);
    await updateDoc(doc(db, 'users', uid), {
      postTemplates: next,
      updatedAt: serverTimestamp(),
    });
  };

  /** Mark a post as claimed by a sitter */
  const claimPost = async (postId: string, sitterId: string): Promise<void> => {
    await approvePostHelperSecure(postId, sitterId);
  };

  /** Cancel a post (poster only) */
  const cancelPost = async (postId: string): Promise<void> => {
    await cancelCommitmentSecure(postId);
  };

  /** Add a responder to a post's respondedBy array (guards against duplicates).
   *  Optional counterPoints: if provided, saves a counter-offer for points-compensated posts.
   */
  const addResponder = async (
    postId: string,
    responder: { userId: string; userName: string; userPhotoURL?: string },
    counterPoints?: number
  ): Promise<void> => {
    void responder;
    await addPostResponseSecure(postId, counterPoints);
  };

  /**
   * Owner responds to a sitter's counter-offer on a points post.
   * Uses arrayRemove + arrayUnion because Firestore can't update array elements in-place.
   */
  const respondToCounter = async (
    postId: string,
    responderId: string,
    accept: boolean
  ): Promise<void> => {
    await respondToPostCounterSecure(postId, responderId, accept);
  };


  /** Remove a responder from a post's respondedBy array */
  const removeResponder = async (postId: string, userId: string): Promise<void> => {
    await removePostResponseSecure(postId, userId);
  };

  /** Fetch open posts where the given user has responded (Pending tab) */
  const getPendingPosts = async (userId: string): Promise<SwapPost[]> => {
    const responseSnap = await getDocs(query(
      collection(db, 'postResponses'),
      where('responderId', '==', userId),
      where('status', '==', 'pending'),
    ));
    const postSnaps = await Promise.all(
      responseSnap.docs.map((response) =>
        getDoc(doc(db, 'publicSwapPosts', String(response.data().postId))),
      ),
    );
    return postSnaps
      .filter((postDoc) => postDoc.exists())
      .map((postDoc) => parsePost(
        postDoc.id,
        postDoc.data() as Record<string, unknown>,
      ))
      .filter((post) => post.status === 'open' && post.posterId !== userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  };

  /**
   * Approve a helper for a post:
   * - Sets status to 'claimed'
   * - Records claimedBy = helperId
   */
  const approveHelper = async (postId: string, helperId: string): Promise<void> => {
    await approvePostHelperSecure(postId, helperId);
  };

  /**
   * Fetch "Accepted" posts for a user:
   * - Posts the user created that are now 'claimed'
   * - Posts where the user is the approved helper (claimedBy === userId)
   */
  const getAcceptedPosts = async (userId: string): Promise<SwapPost[]> => {
    const [posterSnap, helperSnap] = await Promise.all([
      getDocs(query(
        collection(db, 'swapPosts'),
        where('posterId', '==', userId),
        where('status', '==', 'claimed')
      )),
      getDocs(query(
        collection(db, 'swapPosts'),
        where('claimedBy', '==', userId),
        where('status', '==', 'claimed')
      )),
    ]);

    const seen = new Set<string>();
    const results: SwapPost[] = [];

    for (const d of [...posterSnap.docs, ...helperSnap.docs]) {
      if (!seen.has(d.id)) {
        seen.add(d.id);
        results.push(parsePost(d.id, d.data() as Record<string, unknown>));
      }
    }

    return results.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  };

  /**
   * Fetch completed (and late-cancelled) commitments where the user was the
   * sitter. These drop out of getAcceptedPosts (which filters status==='claimed')
   * once a post completes, so they are fetched separately to keep them visible.
   *
   * Uses the same composite index as getAcceptedPosts: (claimedBy, status).
   */
  const getCompletedCommitments = async (userId: string): Promise<SwapPost[]> => {
    const [completedSnap, cancelledSnap] = await Promise.all([
      getDocs(query(
        collection(db, 'swapPosts'),
        where('claimedBy', '==', userId),
        where('status', '==', 'completed')
      )),
      getDocs(query(
        collection(db, 'swapPosts'),
        where('claimedBy', '==', userId),
        where('status', '==', 'cancelled')
      )),
    ]);

    const seen = new Set<string>();
    const results: SwapPost[] = [];

    for (const d of completedSnap.docs) {
      const data = d.data();
      if (!data) continue;
      if (!seen.has(d.id)) {
        seen.add(d.id);
        results.push(parsePost(d.id, data as Record<string, unknown>));
      }
    }

    // Include cancelled commitments only when flagged as a late cancellation.
    for (const d of cancelledSnap.docs) {
      const data = d.data();
      if (!data) continue;
      if (!data.lateCancelled) continue;
      if (!seen.has(d.id)) {
        seen.add(d.id);
        results.push(parsePost(d.id, data as Record<string, unknown>));
      }
    }

    return results.sort((a, b) => b.endDate.getTime() - a.endDate.getTime());
  };


  return {
    // Legacy
    createSwap,
    getSwapsByUser,
    // New posts
    createPost,
    getAreaPosts,
    isPostExpired,
    isStartExpiredNoHelper,
    getMyPosts,
    hidePostFromReuse,
    addPostTemplate,
    updatePostTemplate,
    removePostTemplate,
    claimPost,
    cancelPost,
    addResponder,
    removeResponder,
    getPendingPosts,
    approveHelper,
    getAcceptedPosts,
    getCompletedCommitments,
    respondToCounter,
  };
};
