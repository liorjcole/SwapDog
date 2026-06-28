import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { User as FirebaseUser } from 'firebase/auth';
import {
  collection,
  query,
  where,
  onSnapshot,
  doc,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../config/firebase';
import { parsePost } from './useSwaps';
import { useUsers } from './useUsers';
import { useReviews } from './useReviews';
import { ReviewFlowParams } from './useReviewFlow';
import { resolvePostEndMs } from '../utils/dateHelpers';
import { SwapPost } from '../models/types';

// Re-scan cadence: backstop for the precise per-commitment timers below, in case
// a timer was dropped (e.g. the JS timer queue was throttled in the background).
const SAFETY_SCAN_MS = 30_000;

// setTimeout overflows past ~24.8 days (it stores the delay in a signed 32-bit
// int and fires immediately on overflow). Clamp far-future commitments and
// re-arm when the timer fires.
const MAX_TIMER_MS = 2_000_000_000; // ~23 days

interface UseLiveReviewTriggerArgs {
  user: FirebaseUser | null;
  /** True while the mandatory review gate is already on screen. */
  isGateOpen: boolean;
  /** Opens the shared gate. The hook serializes calls so only one fires at a time. */
  openGate: (params: ReviewFlowParams) => void;
}

/**
 * Fires the inescapable post-commitment review gate the *moment* a claimed
 * commitment ends while the user is in the app — for both owner and caregiver,
 * on any tab. This is the live counterpart to MainTabNavigator's on-open
 * getDoc(pendingReview) path, which only covers the cold-start (not-in-app) case.
 *
 * Mechanism (findings art_iAivowSu, Option C "hybrid"):
 *  - Two onSnapshot listeners keep a live set of the user's active claimed
 *    commitments (posterId === uid OR claimedBy === uid, status === 'claimed'),
 *    mirroring getAcceptedPosts so the set stays fresh app-wide.
 *  - Each commitment gets a precise setTimeout at its resolved end instant, plus
 *    an AppState 'active' re-check and a low-frequency safety scan as backstops.
 *  - On end: open the gate locally (instant for the in-app party) AND write
 *    status:'completed' so the onPostCompleted CF backfills pendingReview for the
 *    other party / cold-start path.
 *
 * Dedupe is three-way so a post is never prompted twice across this live path and
 * the on-open pendingReview path: an in-session handled set, a durable hasReviewed
 * check, and a single-gate queue (a commitment that ends while the gate is open
 * is shown after the current review is submitted).
 */
export const useLiveReviewTrigger = ({
  user,
  isGateOpen,
  openGate,
}: UseLiveReviewTriggerArgs): void => {
  const { getUser } = useUsers();
  const { hasReviewed } = useReviews();

  // Latest-value refs so the subscription effect can stay keyed on uid alone and
  // never re-subscribe when these callbacks/flags change identity.
  const openGateRef = useRef(openGate);
  openGateRef.current = openGate;
  const getUserRef = useRef(getUser);
  getUserRef.current = getUser;
  const hasReviewedRef = useRef(hasReviewed);
  hasReviewedRef.current = hasReviewed;
  const isGateOpenRef = useRef(isGateOpen);
  isGateOpenRef.current = isGateOpen;

  // Cross-render session state for the active user.
  const postsRef = useRef<Map<string, SwapPost>>(new Map());
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const handledRef = useRef<Set<string>>(new Set());
  const triggeringRef = useRef<Set<string>>(new Set());
  const queueRef = useRef<ReviewFlowParams[]>([]);
  // Claimed synchronously when we decide to open, so two commitments ending in
  // the same tick can't both open and clobber each other — the second queues.
  const openLockRef = useRef(false);

  // Drain the queue when the gate closes; release the open-lock once an open is
  // confirmed on screen. This is the only place that advances the sequential
  // one-gate-at-a-time queue.
  useEffect(() => {
    if (isGateOpen) {
      openLockRef.current = false;
      return;
    }
    const next = queueRef.current.shift();
    if (next) {
      openLockRef.current = true;
      openGateRef.current(next);
    }
  }, [isGateOpen]);

  const requestOpen = useCallback((params: ReviewFlowParams) => {
    if (isGateOpenRef.current || openLockRef.current) {
      queueRef.current.push(params);
      return;
    }
    openLockRef.current = true;
    openGateRef.current(params);
  }, []);

  useEffect(() => {
    const uid = user?.uid;
    if (!uid) return;

    // Fresh session state for this user identity.
    handledRef.current = new Set();
    triggeringRef.current = new Set();
    queueRef.current = [];
    postsRef.current = new Map();

    const buildReviewParams = async (post: SwapPost): Promise<ReviewFlowParams | null> => {
      const role: ReviewFlowParams['role'] = post.posterId === uid ? 'owner' : 'caregiver';
      const otherUserId = role === 'owner' ? post.claimedBy : post.posterId;
      if (!otherUserId) return null;

      let otherUserName = 'the other person';
      try {
        const other = await getUserRef.current(otherUserId);
        if (other?.displayName) otherUserName = other.displayName;
      } catch (err) {
        console.error('[LiveReview] getUser failed:', err);
      }

      const dogIds = post.dogIds ?? (post.dogId ? [post.dogId] : []);
      const dogNames = post.dogNames ?? (post.dogName ? [post.dogName] : []);
      return { postId: post.id, role, otherUserId, otherUserName, dogIds, dogNames };
    };

    const triggerReview = async (post: SwapPost): Promise<void> => {
      const postId = post.id;
      if (handledRef.current.has(postId) || triggeringRef.current.has(postId)) return;
      triggeringRef.current.add(postId);
      try {
        const role = post.posterId === uid ? 'owner' : 'caregiver';
        // Owner reviews the caregiver; caregiver reviews the owner (plus dogs).
        const myTarget = role === 'owner' ? 'caregiver' : 'owner';
        const alreadyReviewed = await hasReviewedRef.current(postId, uid, myTarget);
        if (alreadyReviewed) {
          handledRef.current.add(postId);
          return;
        }

        const params = await buildReviewParams(post);
        if (!params) return;

        // Mark handled on first trigger regardless of submit outcome: a failed
        // submit leaves pendingReview intact and re-fires via the on-open /
        // AppState path, not on the next 30s tick (avoids a tight retry loop).
        handledRef.current.add(postId);

        // Backfill for the other party / cold-start: idempotent — the CF only
        // fires on the claimed→completed transition.
        if (post.status !== 'completed') {
          updateDoc(doc(db, 'swapPosts', postId), {
            status: 'completed',
            updatedAt: serverTimestamp(),
          }).catch((err) =>
            console.error('[LiveReview] Failed to mark post completed:', postId, err),
          );
        }

        requestOpen(params);
      } catch (err) {
        console.error('[LiveReview] triggerReview failed:', postId, err);
      } finally {
        triggeringRef.current.delete(postId);
      }
    };

    const scheduleTimer = (post: SwapPost): void => {
      const postId = post.id;
      if (handledRef.current.has(postId)) return;

      const existing = timersRef.current.get(postId);
      if (existing) {
        clearTimeout(existing);
        timersRef.current.delete(postId);
      }

      const endMs = resolvePostEndMs(post);
      if (endMs === null) return;

      const delay = endMs - Date.now();
      if (delay <= 0) {
        void triggerReview(post);
        return;
      }

      const timer = setTimeout(() => {
        timersRef.current.delete(postId);
        const fresh = postsRef.current.get(postId);
        if (!fresh) return;
        const freshEnd = resolvePostEndMs(fresh);
        if (freshEnd !== null && Date.now() >= freshEnd) void triggerReview(fresh);
        else scheduleTimer(fresh); // far-future clamp re-arm
      }, Math.min(delay, MAX_TIMER_MS));
      timersRef.current.set(postId, timer);
    };

    const evaluateNow = (): void => {
      const now = Date.now();
      for (const post of postsRef.current.values()) {
        if (handledRef.current.has(post.id)) continue;
        const endMs = resolvePostEndMs(post);
        if (endMs !== null && now >= endMs) void triggerReview(post);
      }
    };

    const reschedule = (): void => {
      for (const [postId, timer] of timersRef.current) {
        if (!postsRef.current.has(postId)) {
          clearTimeout(timer);
          timersRef.current.delete(postId);
        }
      }
      for (const post of postsRef.current.values()) scheduleTimer(post);
    };

    // Two listeners (poster + claimedBy), each keeping its own slice; merged into
    // postsRef on every snapshot. Mirrors getAcceptedPosts' two-query shape and
    // sidesteps composite OR-index requirements.
    const posterSlice = new Map<string, SwapPost>();
    const helperSlice = new Map<string, SwapPost>();

    const reconcile = (): void => {
      const merged = new Map<string, SwapPost>();
      for (const [id, p] of posterSlice) merged.set(id, p);
      for (const [id, p] of helperSlice) if (!merged.has(id)) merged.set(id, p);
      postsRef.current = merged;
      reschedule();
      evaluateNow();
    };

    const subscribe = (field: 'posterId' | 'claimedBy', slice: Map<string, SwapPost>) =>
      onSnapshot(
        query(
          collection(db, 'swapPosts'),
          where(field, '==', uid),
          where('status', '==', 'claimed'),
        ),
        (snap) => {
          slice.clear();
          snap.forEach((d) => {
            const data = d.data();
            if (!data) return;
            slice.set(d.id, parsePost(d.id, data as Record<string, unknown>));
          });
          reconcile();
        },
        (err) => console.error('[LiveReview] snapshot error:', err),
      );

    const unsubPoster = subscribe('posterId', posterSlice);
    const unsubHelper = subscribe('claimedBy', helperSlice);

    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') evaluateNow();
    });
    const safetyInterval = setInterval(evaluateNow, SAFETY_SCAN_MS);

    return () => {
      unsubPoster();
      unsubHelper();
      appStateSub.remove();
      clearInterval(safetyInterval);
      for (const timer of timersRef.current.values()) clearTimeout(timer);
      timersRef.current.clear();
    };
  }, [user, requestOpen]);
};

