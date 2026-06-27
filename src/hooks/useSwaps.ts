import {
  collection,
  addDoc,
  getDocs,
  getDoc,
  updateDoc,
  doc,
  query,
  where,
  serverTimestamp,
  or,
  arrayUnion,
  arrayRemove,
} from 'firebase/firestore';
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
  status: (data.status as PostStatus) ?? 'open',
  claimedBy: data.claimedBy as string | undefined,
  rescheduleProposedStart: data.rescheduleProposedStart ? toDate(data.rescheduleProposedStart as Parameters<typeof toDate>[0]) : undefined,
  rescheduleProposedEnd: data.rescheduleProposedEnd ? toDate(data.rescheduleProposedEnd as Parameters<typeof toDate>[0]) : undefined,
  rescheduleNote: data.rescheduleNote as string | undefined,
  rescheduleProposedBy: data.rescheduleProposedBy as string | undefined,
  respondedBy: (() => {
    const raw = data.respondedBy as Array<Record<string, unknown>> | undefined;
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
    const ref = await addDoc(collection(db, 'swapRequests'), {
      ...data,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return ref.id;
  };

  const getSwapsByUser = async (userId: string): Promise<SwapRequest[]> => {
    const q = query(
      collection(db, 'swapRequests'),
      or(where('requesterId', '==', userId), where('receiverId', '==', userId))
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => parseSwap(d.id, d.data() as Record<string, unknown>));
  };

  const updateSwapStatus = async (id: string, status: SwapStatus): Promise<void> => {
    await updateDoc(doc(db, 'swapRequests', id), { status, updatedAt: serverTimestamp() });
  };

  const updateSwapSitterPreference = async (
    id: string,
    sitterPreference: SitterPreference,
    status: SwapStatus
  ): Promise<void> => {
    await updateDoc(doc(db, 'swapRequests', id), {
      sitterPreference,
      status,
      updatedAt: serverTimestamp(),
    });
  };

  // ── NEW: Public post ops ──────────────────────────────────────────────────

  /** Create a new public post visible to everyone in the poster's area */
  const createPost = async (
    data: Omit<SwapPost, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<string> => {
    // Firestore rejects undefined field values — strip them before writing
    const cleanData = Object.fromEntries(
      Object.entries(data as Record<string, unknown>).filter(([, v]) => v !== undefined)
    );
    const ref = await addDoc(collection(db, 'swapPosts'), {
      ...cleanData,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return ref.id;
  };

  /** Fetch all open posts, optionally filtered by distance */
  /** Check if a post's end date/time has passed */
  const isPostExpired = (post: SwapPost): boolean => {
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
    return now > end;
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

  const getAreaPosts = async (
    location?: { latitude: number; longitude: number },
    radiusMiles = 25
  ): Promise<SwapPost[]> => {
    const q = query(
      collection(db, 'swapPosts'),
      where('status', '==', 'open')
    );
    const snap = await getDocs(q);
    const all = snap.docs
      .map((d) => parsePost(d.id, d.data() as Record<string, unknown>))
      .filter((p) =>
        p.status === 'open' &&
        !isPostExpired(p) &&
        !isStartExpiredNoHelper(p) &&   // exclude start-expired posts with no helper
        !((p as any).pointsDisabled)
      ); // exclude claimed/cancelled/expired/points-disabled

    if (!location) return all;

    return all.filter((p) => {
      if (!p.posterLocation) return true; // include posts without location
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
    await updateDoc(doc(db, 'swapPosts', postId), {
      status: 'claimed' as PostStatus,
      claimedBy: sitterId,
      updatedAt: serverTimestamp(),
    });
  };

  /** Cancel a post (poster only) */
  const cancelPost = async (postId: string): Promise<void> => {
    await updateDoc(doc(db, 'swapPosts', postId), {
      status: 'cancelled' as PostStatus,
      updatedAt: serverTimestamp(),
    });
  };

  /** Add a responder to a post's respondedBy array (guards against duplicates).
   *  Optional counterPoints: if provided, saves a counter-offer for points-compensated posts.
   */
  const addResponder = async (
    postId: string,
    responder: { userId: string; userName: string; userPhotoURL?: string },
    counterPoints?: number
  ): Promise<void> => {
    // Server-side duplicate guard: read the doc first
    const postSnap = await getDoc(doc(db, 'swapPosts', postId));
    if (postSnap.exists()) {
      const data = postSnap.data() as Record<string, unknown>;
      const existing = (data.respondedBy as Array<Record<string, unknown>> | undefined) ?? [];
      if (existing.some((r) => r.userId === responder.userId)) {
        // Already responded — skip the write
        return;
      }
    }
    const entry: Record<string, unknown> = {
      userId: responder.userId,
      userName: responder.userName,
      userPhotoURL: responder.userPhotoURL ?? null,
      respondedAt: new Date(),
    };
    if (counterPoints !== undefined) {
      entry.counterPoints = counterPoints;
      entry.counterStatus = 'pending';
    }
    await updateDoc(doc(db, 'swapPosts', postId), {
      respondedBy: arrayUnion(entry),
      updatedAt: serverTimestamp(),
    });
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
    const postSnap = await getDoc(doc(db, 'swapPosts', postId));
    if (!postSnap.exists()) throw new Error('Post not found');
    const data = postSnap.data() as Record<string, unknown>;
    const existing = (data.respondedBy as Array<Record<string, unknown>> | undefined) ?? [];
    const entry = existing.find((r) => r.userId === responderId);
    if (!entry) throw new Error('Responder not found');

    // Remove old entry and re-add with updated counterStatus
    const updatedEntry = { ...entry, counterStatus: accept ? 'accepted' : 'declined' };
    await updateDoc(doc(db, 'swapPosts', postId), {
      respondedBy: arrayRemove(entry),
      updatedAt: serverTimestamp(),
    });
    await updateDoc(doc(db, 'swapPosts', postId), {
      respondedBy: arrayUnion(updatedEntry),
      updatedAt: serverTimestamp(),
    });
  };


  /** Remove a responder from a post's respondedBy array */
  const removeResponder = async (postId: string, userId: string): Promise<void> => {
    const postSnap = await getDoc(doc(db, 'swapPosts', postId));
    if (!postSnap.exists()) return;
    const data = postSnap.data() as Record<string, unknown>;
    const existing = (data.respondedBy as Array<Record<string, unknown>> | undefined) ?? [];
    const entry = existing.find((r) => r.userId === userId);
    if (!entry) return; // not in the list
    await updateDoc(doc(db, 'swapPosts', postId), {
      respondedBy: arrayRemove(entry),
      updatedAt: serverTimestamp(),
    });
  };

  /** Fetch open posts where the given user has responded (Pending tab) */
  const getPendingPosts = async (userId: string): Promise<SwapPost[]> => {
    // Firestore doesn't support querying inside array-of-maps directly,
    // so we fetch all open posts and filter client-side.
    const q = query(
      collection(db, 'swapPosts'),
      where('status', '==', 'open')
    );
    const snap = await getDocs(q);
    const all = snap.docs.map((d) => parsePost(d.id, d.data() as Record<string, unknown>));
    return all.filter(
      (p) =>
        p.posterId !== userId &&
        (p.respondedBy ?? []).some((r) => r.userId === userId)
    ).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  };

  /**
   * Approve a helper for a post:
   * - Sets status to 'claimed'
   * - Records claimedBy = helperId
   */
  const approveHelper = async (postId: string, helperId: string): Promise<void> => {
    await updateDoc(doc(db, 'swapPosts', postId), {
      status: 'claimed' as PostStatus,
      claimedBy: helperId,
      updatedAt: serverTimestamp(),
    });
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
   * Persist owner-side reminder notification IDs to Firestore so they can
   * be cancelled if the post is later cancelled.
   */
  const saveOwnerReminderIds = async (postId: string, ids: string[]): Promise<void> => {
    await updateDoc(doc(db, 'swapPosts', postId), {
      reminderNotificationIds: ids,
      updatedAt: serverTimestamp(),
    });
  };

  /**
   * Persist sitter-side reminder notification IDs to Firestore to track
   * that this sitter's device has already scheduled them.
   */
  const saveSitterReminderIds = async (postId: string, ids: string[]): Promise<void> => {
    await updateDoc(doc(db, 'swapPosts', postId), {
      sitterReminderNotificationIds: ids,
      updatedAt: serverTimestamp(),
    });
  };

  return {
    // Legacy
    createSwap,
    getSwapsByUser,
    updateSwapStatus,
    updateSwapSitterPreference,
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
    saveOwnerReminderIds,
    saveSitterReminderIds,
    respondToCounter,
  };
};
