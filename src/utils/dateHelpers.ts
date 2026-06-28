import { SwapPost } from '../models/types';

/**
 * Smart date formatting — "Today", "Tomorrow", or "May 23" style.
 * Compares calendar dates only (ignores time).
 */
export function smartDate(
  date: Date,
  options?: { includeYear?: boolean },
): string {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dateStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round(
    (dateStart.getTime() - todayStart.getTime()) / (1000 * 60 * 60 * 24),
  );

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Tomorrow';

  const fmt: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  if (options?.includeYear) fmt.year = 'numeric';
  return date.toLocaleDateString(undefined, fmt);
}

/**
 * Parse a 12-hour AM/PM time string (e.g. "9:00 AM") and apply it to
 * the given Date's hours/minutes in-place. Returns the mutated date,
 * or the original if the string does not match the expected format.
 */
export function applyTimeString(date: Date, timeStr: string): Date {
  const match = timeStr.match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!match) return date;
  let h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  if (match[3].toUpperCase() === 'PM' && h !== 12) h += 12;
  if (match[3].toUpperCase() === 'AM' && h === 12) h = 0;
  date.setHours(h, m, 0, 0);
  return date;
}

/**
 * Format an epoch-ms timestamp as a short 12-hour time string, e.g. "9:00 AM".
 */
export function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Format a Date as a short month + day string, e.g. "Jun 28".
 */
export function formatShortDate(date: Date): string {
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Convert a stored 12-hour time string ("9:00 AM" / "5:00 PM") to compact
 * lowercase form ("9:00am" / "5:00pm") for inline display next to a date.
 * Returns an empty string for missing/empty input.
 */
export function formatTimeLower(timeStr?: string): string {
  if (!timeStr) return '';
  return timeStr.replace(/\s*(AM|PM)/i, (_, p: string) => p.toLowerCase());
}

/**
 * Returns true when two Dates fall on the same calendar day.
 */
export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Single source of truth for "is this event happening right now?".
 *
 * Resolves the post's effective start/end the same way EventProgressBar does
 * (date + optional AM/PM time string; missing times anchor to start/end of day)
 * and returns true only while now is within [start, end). Returns false for
 * missing/degenerate date windows so callers can drop it in unconditionally.
 *
 * Used by EventProgressBar (its render gate) and the Schedule "Happening now"
 * banner driver — keeping both in lockstep: if the bar would render, the
 * banner shows, and vice-versa.
 */
export function isPostInProgress(post: SwapPost, nowMs: number = Date.now()): boolean {
  if (!post?.startDate || !post?.endDate) return false;

  const start = new Date(post.startDate);
  if (post.startTime) applyTimeString(start, post.startTime);
  else start.setHours(0, 0, 0, 0);

  const startMs = start.getTime();
  const endMs = resolvePostEndMs(post);
  if (endMs === null || endMs <= startMs) return false;

  return nowMs >= startMs && nowMs < endMs;
}

/**
 * Resolve a post's effective END instant as epoch-ms, the same way
 * isPostInProgress / isPostExpired do: combine endDate with the optional AM/PM
 * endTime string, anchoring a missing time to the very end of the day
 * (23:59:59.999). For a multi-day post this is the final endDate's instant.
 *
 * Returns null when the post has no endDate so callers can guard uniformly.
 * Use this to schedule a precise "event just ended" timer.
 */
export function resolvePostEndMs(post: SwapPost): number | null {
  if (!post?.endDate) return null;
  const end = new Date(post.endDate);
  if (post.endTime) applyTimeString(end, post.endTime);
  else end.setHours(23, 59, 59, 999);
  return end.getTime();
}

/**
 * Returns true once now >= the post's effective start moment — covers both
 * in-progress bookings AND events that have already ended.
 *
 * Uses the same start-resolution logic as isPostInProgress / EventProgressBar:
 *   startDate @ startTime (or startDate @ 00:00 when startTime is absent).
 *
 * Returns false when startDate is absent — safe to use unconditionally.
 */
export function hasEventStarted(post: SwapPost, nowMs: number = Date.now()): boolean {
  if (!post?.startDate) return false;

  const start = new Date(post.startDate);
  if (post.startTime) applyTimeString(start, post.startTime);
  else start.setHours(0, 0, 0, 0);

  return nowMs >= start.getTime();
}
