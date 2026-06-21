/**
 * Module-level store for cross-tab highlight communication.
 *
 * Route params don't reliably propagate through nested navigators
 * (tab → stack → screen) when the target screen is already mounted.
 * This simple store bypasses that entirely:
 *   - CreatePostScreen sets the post ID before switching tabs
 *   - DiscoverScreen checks for it on every focus event
 *   - consume() returns and clears in one call (no double-fire)
 */
let pendingHighlightPostId: string | null = null;

export const setPendingHighlightPost = (id: string) => {
  pendingHighlightPostId = id;
};

export const consumePendingHighlightPost = (): string | null => {
  const id = pendingHighlightPostId;
  pendingHighlightPostId = null;
  return id;
};
