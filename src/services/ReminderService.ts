/**
 * ReminderService — schedules (and cancels) local push notifications
 * for approved swap posts.
 *
 * Scheduling strategy:
 *   • Owner reminders are scheduled on the owner's device immediately after
 *     they approve a helper (in PostDetailScreen).
 *   • Sitter reminders are scheduled on the sitter's device the first time
 *     they view the Accepted tab after being approved (in RequestsScreen).
 *
 * Each approved post gets up to 2 owner reminders + 2 sitter reminders (4 total
 * across both devices). Reminders that would fire in the past are silently skipped.
 *
 * Reminder schedule:
 *   1. 24 hours before start time
 *   2. 1 hour before start time
 */

import * as Notifications from 'expo-notifications';

// ─── Permissions ──────────────────────────────────────────────────────────────

export const requestNotificationPermissions = async (): Promise<boolean> => {
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return true;

  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns a Date offset from `base` by the given number of milliseconds.
 * Returns null if the result would already be in the past.
 */
const futureDate = (base: Date, offsetMs: number): Date | null => {
  const d = new Date(base.getTime() + offsetMs);
  return d > new Date() ? d : null;
};

/**
 * Format a Date to a short readable time string (e.g. "2:30 PM").
 */
const formatTime = (date: Date): string => {
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
};

const MS_24_HOURS = -24 * 60 * 60 * 1000;
const MS_1_HOUR = -1 * 60 * 60 * 1000;

/**
 * Schedule a single local notification at a future date.
 * Returns the notification ID, or null if the date is in the past / scheduling fails.
 */
const scheduleOne = async (
  title: string,
  body: string,
  date: Date | null
): Promise<string | null> => {
  if (!date) return null;
  try {
    const id = await Notifications.scheduleNotificationAsync({
      content: { title, body, sound: true },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date,
      },
    });
    return id;
  } catch {
    return null;
  }
};

// ─── Public API ───────────────────────────────────────────────────────────────

export interface SwapReminderParams {
  startDate: Date;
  dogName: string;
  ownerName: string;
  sitterName: string;
}

export interface ScheduledReminderIds {
  ownerIds: string[];
  sitterIds: string[];
}

/**
 * Schedule all owner-side reminders for an approved swap post.
 * Call this on the OWNER's device right after approveHelper() succeeds.
 * Returns the scheduled notification IDs (may be fewer than 2 if some are in the past).
 */
export const scheduleOwnerReminders = async (
  params: SwapReminderParams
): Promise<string[]> => {
  const { startDate, dogName, sitterName } = params;
  const timeStr = formatTime(startDate);

  const results = await Promise.all([
    // 24 hours before
    scheduleOne(
      `Tomorrow: ${sitterName} has a scheduled event with ${dogName} 🐾`,
      `${sitterName} has ${dogName} tomorrow at ${timeStr}. Send them a message if there's anything they should know!`,
      futureDate(startDate, MS_24_HOURS)
    ),
    // 1 hour before
    scheduleOne(
      `${dogName}'s session is about to start 🐕`,
      `${sitterName} is starting with ${dogName} in 1 hour. Make sure they have everything they need!`,
      futureDate(startDate, MS_1_HOUR)
    ),
  ]);

  return results.filter((id): id is string => id !== null);
};

/**
 * Schedule all sitter-side reminders for an approved swap post.
 * Call this on the SITTER's device when they first see the post in the Accepted tab.
 * Returns the scheduled notification IDs.
 */
export const scheduleSitterReminders = async (
  params: SwapReminderParams
): Promise<string[]> => {
  const { startDate, dogName, ownerName } = params;
  const timeStr = formatTime(startDate);

  const results = await Promise.all([
    // 24 hours before
    scheduleOne(
      `Tomorrow: You have a scheduled event with ${dogName} 🐾`,
      `Your time with ${dogName} starts tomorrow at ${timeStr}. Reach out to ${ownerName} if you have any last-minute questions!`,
      futureDate(startDate, MS_24_HOURS)
    ),
    // 1 hour before
    scheduleOne(
      `Starting soon: ${dogName} 🐕`,
      `Your session with ${dogName} starts in 1 hour. Have a great time!`,
      futureDate(startDate, MS_1_HOUR)
    ),
  ]);

  return results.filter((id): id is string => id !== null);
};

/**
 * Cancel a list of scheduled notifications by ID.
 * Safe to call with an empty array or undefined IDs.
 */
export const cancelSwapReminders = async (ids: string[]): Promise<void> => {
  if (!ids || ids.length === 0) return;
  await Promise.all(ids.map((id) => Notifications.cancelScheduledNotificationAsync(id)));
};
