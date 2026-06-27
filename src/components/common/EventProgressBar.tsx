import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { SwapPost } from '../../models/types';
import {
  isSameDay,
  applyTimeString,
  formatTime,
  formatShortDate,
} from '../../utils/dateHelpers';

interface Props {
  post: SwapPost;
  /** Optional outer container overrides — used by call sites to set margins. */
  style?: ViewStyle;
}

/**
 * Horizontal progress bar shown at the bottom of a booking card while
 * the event is actively in progress (now >= start && now < end).
 *
 * Returns null before start, after end, or when date fields are missing —
 * so every call site can drop it in unconditionally.
 *
 * Pole labels:
 *   • same-day events  → start / end TIME strings (e.g. "2:00 PM" → "6:00 PM")
 *   • multi-day events → start / end SHORT DATE strings (e.g. "Jun 28" → "Jun 30")
 *
 * Fill advances once per minute via a local setInterval (cleaned up on unmount).
 */
export default function EventProgressBar({ post, style }: Props) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Tick once per minute to advance the fill while the screen is open.
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Guard: require valid date fields before doing any math.
  if (!post?.startDate || !post?.endDate) return null;

  // Resolve start/end epoch ms — copy to avoid mutating the post.
  const start = new Date(post.startDate);
  const end = new Date(post.endDate);

  if (post.startTime) {
    applyTimeString(start, post.startTime);
  } else {
    start.setHours(0, 0, 0, 0); // start-of-day anchor
  }

  if (post.endTime) {
    applyTimeString(end, post.endTime);
  } else {
    end.setHours(23, 59, 59, 999); // end-of-day anchor (mirrors isPostExpired)
  }

  const startMs = start.getTime();
  const endMs = end.getTime();

  // Guard: degenerate window.
  if (endMs <= startMs) return null;

  // Not in progress — render nothing so the layout doesn't shift.
  if (nowMs < startMs || nowMs >= endMs) return null;

  const pct = Math.min(100, Math.max(0, ((nowMs - startMs) / (endMs - startMs)) * 100));

  // Pole labels: times for same-day, short dates for multi-day.
  const sameDay = isSameDay(post.startDate, post.endDate);
  const leftLabel = sameDay
    ? (post.startTime ?? formatTime(startMs))
    : formatShortDate(post.startDate);
  const rightLabel = sameDay
    ? (post.endTime ?? formatTime(endMs))
    : formatShortDate(post.endDate);

  return (
    <View style={[styles.container, style]}>
      {/* Track */}
      <View style={styles.track}>
        {/* Fill — width is dynamic so it lives in an inline style */}
        <View style={[styles.fill, { width: `${pct}%` as `${number}%` }]} />
      </View>
      {/* Pole labels */}
      <View style={styles.labels}>
        <Text style={styles.label}>{leftLabel}</Text>
        <Text style={styles.label}>{rightLabel}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 10,
  },
  track: {
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.18)',
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 3,
  },
  labels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 3,
  },
  label: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.55)',
  },
});

