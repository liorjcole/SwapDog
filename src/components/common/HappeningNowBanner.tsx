import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated } from 'react-native';
import { SwapPost } from '../../models/types';
import { spacing, borderRadius, shadow } from '../../config/theme';
import EventProgressBar from './EventProgressBar';

interface Props {
  post: SwapPost;
  /** Context accent: pink (#FF2D55) when it's your post, teal (#2DD4BF) when it's your commitment. */
  accent: string;
  /** Care-type emoji from the shared map. */
  careIcon: string;
  /** Human label for the care context, e.g. "Your dog is being cared for". */
  contextLabel: string;
  /** Card background — pass the themed surface color. */
  backgroundColor: string;
  /** Primary text color — pass the themed text color. */
  textColor: string;
  onPress: () => void;
}

/**
 * Focal "Happening now" card for an event currently in progress.
 *
 * Pinned at the top of the Schedule screen above the calendar. Renders a
 * prominent accented card (pink for your post, teal for your commitment) with
 * a live pulsing dot, the dog name(s) + care-type, and the shared
 * EventProgressBar shading line. The parent decides which posts are live (via
 * isPostInProgress) and renders one banner per live event.
 */
export default function HappeningNowBanner({
  post,
  accent,
  careIcon,
  contextLabel,
  backgroundColor,
  textColor,
  onPress,
}: Props) {
  const pulse = useRef(new Animated.Value(1)).current;

  // Gentle live pulse on the status dot. Looping animation, stopped on unmount.
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.35, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const dogName =
    post.dogNames && post.dogNames.length > 0
      ? post.dogNames.join(' & ')
      : post.dogName;

  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor, borderColor: accent, ...shadow.lg }]}
      onPress={onPress}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={`Happening now: ${dogName}`}
    >
      <View style={styles.flairRow}>
        <Animated.View style={[styles.liveDot, { backgroundColor: accent, opacity: pulse }]} />
        <Text style={[styles.flair, { color: accent }]}>HAPPENING NOW</Text>
      </View>

      <View style={styles.titleRow}>
        <Text style={styles.icon}>{careIcon}</Text>
        <Text style={[styles.dogName, { color: textColor }]} numberOfLines={1}>
          {dogName}
        </Text>
      </View>

      <Text style={[styles.context, { color: accent }]} numberOfLines={1}>
        {contextLabel}
      </Text>

      <EventProgressBar post={post} style={{ marginTop: spacing.sm }} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: borderRadius.lg,
    borderWidth: 1.5,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  flairRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  liveDot: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
  },
  flair: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  icon: {
    fontSize: 20,
  },
  dogName: {
    fontSize: 20,
    fontWeight: '800',
    flex: 1,
  },
  context: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 2,
  },
});

