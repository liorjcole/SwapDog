/**
 * ReminderService — schedules (and cancels) LOCAL push notifications for
 * add-on tasks during a stay (feeding/walk/play/medication repeat schedules).
 *
 * NOTE: The main-session 1h/10min commitment reminders for the owner and
 * caregiver are now scheduled SERVER-SIDE (Cloud Functions: onHelpConfirmed →
 * scheduleReminders, delivered by the processReminders cron). The old
 * client-side owner/sitter local scheduling was removed to avoid duplicate and
 * mistimed notifications.
 */

import * as Notifications from 'expo-notifications';


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


/**
 * Cancel a list of scheduled notifications by ID.
 * Safe to call with an empty array or undefined IDs.
 */
export const cancelSwapReminders = async (ids: string[]): Promise<void> => {
  if (!ids || ids.length === 0) return;
  await Promise.all(ids.map((id) => Notifications.cancelScheduledNotificationAsync(id)));
};

// ── Add-on repeat schedule reminders ──────────────────────────────────────────

import { RepeatSchedule } from '../models/types';

const MS_10_MIN = -10 * 60 * 1000;

export interface AddOnReminderParams {
  /** Start date of the overnight stay */
  stayStartDate: Date;
  /** End date of the overnight stay */
  stayEndDate: Date;
  /** Name of the add-on task (e.g. "Feeding", "Walk") */
  taskName: string;
  /** Dog name */
  dogName: string;
  /** Sitter name (who receives the reminder) */
  sitterName: string;
  /** The repeat schedule configured for this add-on */
  schedule: RepeatSchedule;
  /** Default time for the task (used when timeMode is 'same') */
  defaultTime: string; // "2:00 PM" format
}

/**
 * Parse a "h:mm AM/PM" string into { hour, minute } (24h).
 */
const parseTime12 = (timeStr: string): { hour: number; minute: number } => {
  const match = timeStr.match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!match) return { hour: 12, minute: 0 };
  let h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  const ampm = match[3].toUpperCase();
  if (ampm === 'PM' && h !== 12) h += 12;
  if (ampm === 'AM' && h === 12) h = 0;
  return { hour: h, minute: m };
};

/**
 * Returns the days of the week (0-6) that a repeat schedule covers.
 */
const getScheduleDays = (schedule: RepeatSchedule): number[] => {
  switch (schedule.type) {
    case 'daily':
      return [0, 1, 2, 3, 4, 5, 6];
    case 'weekly':
      return [schedule.weeklyDay ?? 1];
    case 'custom':
      return schedule.customDays ?? [];
    default:
      return [];
  }
};

/**
 * Schedule local push notifications for a repeating add-on task during an
 * overnight stay. Schedules 1-hour-before and 10-minute-before reminders
 * for each matching day in the stay range.
 *
 * Returns the scheduled notification IDs for later cancellation.
 */
export const scheduleAddOnReminders = async (
  params: AddOnReminderParams
): Promise<string[]> => {
  const { stayStartDate, stayEndDate, taskName, dogName, schedule, defaultTime } = params;
  const scheduleDays = getScheduleDays(schedule);
  const defaultParsed = parseTime12(defaultTime);
  const ids: string[] = [];

  // Iterate each day of the stay
  const current = new Date(stayStartDate);
  current.setHours(0, 0, 0, 0);
  const end = new Date(stayEndDate);
  end.setHours(23, 59, 59, 999);

  while (current <= end) {
    const dayOfWeek = current.getDay(); // 0=Sun ... 6=Sat

    if (scheduleDays.includes(dayOfWeek)) {
      // Determine the time for this day
      let time = defaultParsed;
      if (schedule.timeMode === 'different' && schedule.dayTimes?.[dayOfWeek]) {
        time = parseTime12(schedule.dayTimes[dayOfWeek]);
      }

      const taskDate = new Date(current);
      taskDate.setHours(time.hour, time.minute, 0, 0);

      const timeStr = formatTime(taskDate);

      // 1 hour before
      const id1h = await scheduleOne(
        `${taskName} for ${dogName} in 1 hour 🐾`,
        `${taskName} is scheduled at ${timeStr}. Make sure everything is ready!`,
        futureDate(taskDate, MS_1_HOUR)
      );
      if (id1h) ids.push(id1h);

      // 10 minutes before
      const id10m = await scheduleOne(
        `${taskName} for ${dogName} in 10 minutes 🐕`,
        `Time to get ready — ${taskName} starts at ${timeStr}!`,
        futureDate(taskDate, MS_10_MIN)
      );
      if (id10m) ids.push(id10m);
    }

    current.setDate(current.getDate() + 1);
  }

  return ids;
};
