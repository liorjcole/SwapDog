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
 * Returns true when two Dates fall on the same calendar day.
 */
export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
