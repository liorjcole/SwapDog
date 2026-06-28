import { useState, useEffect, useCallback } from 'react';
import { SwapPost } from '../models/types';
import { useSwaps } from './useSwaps';
import { isPostInProgress } from '../utils/dateHelpers';
import { useAuthContext } from '../contexts/AuthContext';
import { getCareTypeIcon } from '../utils/careTypeHelpers';

export interface LiveEvent {
  post: SwapPost;
  own: boolean;       // true = your claimed post (pink), false = your commitment (teal)
  accent: string;     // '#FF2D55' | '#2DD4BF'
  careIcon: string;   // emoji
  contextLabel: string;
}

export interface UseHappeningNowResult {
  liveEvents: LiveEvent[];
  refresh: () => Promise<void>;
}

const PINK = '#FF2D55';
const TEAL = '#2DD4BF';

/**
 * Fetches the user’s active (in-progress) swaps and derives the banner list.
 * Refreshes on mount; the 60s tick keeps banners appearing/disappearing without
 * a manual pull-to-refresh. Safe to mount on multiple screens simultaneously —
 * each instance owns its own lightweight fetch + interval.
 */
export function useHappeningNow(): UseHappeningNowResult {
  const { user } = useAuthContext();
  const { getMyPosts, getAcceptedPosts } = useSwaps();

  const [myPosts, setMyPosts]           = useState<SwapPost[]>([]);
  const [acceptedPosts, setAcceptedPosts] = useState<SwapPost[]>([]);
  const [nowTick, setNowTick]           = useState(() => Date.now());

  // 60s re-evaluation tick — matches EventProgressBar cadence.
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    if (!user?.uid) return;
    const [mine, accepted] = await Promise.all([
      getMyPosts(user.uid),
      getAcceptedPosts(user.uid),
    ]);
    setMyPosts(mine);
    setAcceptedPosts(accepted);
  }, [user?.uid, getMyPosts, getAcceptedPosts]);

  // Initial fetch on mount.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const sitterCommitments = acceptedPosts.filter((p) => p.claimedBy === user?.uid);

  const liveEvents: LiveEvent[] = [
    ...myPosts
      .filter((p) => p.status === 'claimed' && isPostInProgress(p, nowTick))
      .map((p): LiveEvent => ({
        post: p,
        own: true,
        accent: PINK,
        careIcon: getCareTypeIcon(p.careType),
        contextLabel: 'Your dog is being cared for',
      })),
    ...sitterCommitments
      .filter((p) => isPostInProgress(p, nowTick))
      .map((p): LiveEvent => ({
        post: p,
        own: false,
        accent: TEAL,
        careIcon: getCareTypeIcon(p.careType),
        contextLabel: "You're caring for their dog",
      })),
  ].sort((a, b) => b.post.startDate.getTime() - a.post.startDate.getTime());

  return { liveEvents, refresh };
}

