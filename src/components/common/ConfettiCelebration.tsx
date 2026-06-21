import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, Modal, Animated, Dimensions, StyleSheet, TouchableOpacity,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../../contexts/ThemeContext';
import { spacing, borderRadius, typography, shadow, SPLASH_COLOR, colors as themeColors } from '../../config/theme';

const { width: W, height: H } = Dimensions.get('window');
const NUM_PIECES = 45;

const CONFETTI_COLORS = [
  SPLASH_COLOR,          // hot pink-red #FF2D55
  themeColors.secondary, // teal #4ECDC4
  '#FF6B81',             // light pink
  '#FFD93D',             // gold
  '#6C5CE7',             // purple
  '#A8E6CF',             // mint
];

interface ConfettiPiece {
  x: Animated.Value;
  y: Animated.Value;
  rotate: Animated.Value;
  opacity: Animated.Value;
  color: string;
  size: number;
  startX: number;
}

export interface CelebrationItem {
  title: string;
  subtitle?: string;
  emoji?: string;
  buttonLabel?: string;
  actionLabel?: string;
  onAction?: () => void;
}

interface Props {
  queue: CelebrationItem[];
  onDismissAll: () => void;
}

const ConfettiCelebration: React.FC<Props> = ({ queue, onDismissAll }) => {
  const { colors } = useTheme();
  const [currentIndex, setCurrentIndex] = useState(0);
  const isMounted = useRef(true);

  const [pieces] = useState<ConfettiPiece[]>(() =>
    Array.from({ length: NUM_PIECES }, () => ({
      x: new Animated.Value(0),
      y: new Animated.Value(-30),
      rotate: new Animated.Value(0),
      opacity: new Animated.Value(1),
      color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
      size: 6 + Math.random() * 8,
      startX: Math.random() * W,
    }))
  );

  const current = queue[currentIndex];
  const visible = queue.length > 0 && !!current;

  const runConfetti = () => {
    if (!isMounted.current) return;

    const animations = pieces.map((piece) => {
      piece.y.setValue(-30);
      piece.x.setValue(0);
      piece.rotate.setValue(0);
      piece.opacity.setValue(1);

      const duration = 2800 + Math.random() * 2000;
      const delay = Math.random() * 2000;
      const driftX = (Math.random() - 0.5) * 140;
      const rotations = (Math.random() > 0.5 ? 1 : -1) * (360 + Math.random() * 720);

      return Animated.sequence([
        Animated.delay(delay),
        Animated.parallel([
          Animated.timing(piece.y, {
            toValue: H + 60,
            duration,
            useNativeDriver: true,
          }),
          Animated.timing(piece.x, {
            toValue: driftX,
            duration,
            useNativeDriver: true,
          }),
          Animated.timing(piece.rotate, {
            toValue: rotations,
            duration,
            useNativeDriver: true,
          }),
          Animated.sequence([
            Animated.timing(piece.opacity, {
              toValue: 1,
              duration: duration * 0.65,
              useNativeDriver: true,
            }),
            Animated.timing(piece.opacity, {
              toValue: 0,
              duration: duration * 0.35,
              useNativeDriver: true,
            }),
          ]),
        ]),
      ]);
    });

    Animated.parallel(animations).start(() => {
      if (isMounted.current) runConfetti();
    });
  };

  useEffect(() => {
    if (!visible) return;
    isMounted.current = true;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    runConfetti();
    return () => {
      isMounted.current = false;
    };
  }, [visible, currentIndex]);

  const handleDismiss = () => {
    isMounted.current = false;
    if (currentIndex < queue.length - 1) {
      setCurrentIndex((i) => i + 1);
    } else {
      setCurrentIndex(0);
      onDismissAll();
    }
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent={true} animationType="fade">
      <View style={[styles.container, { backgroundColor: 'rgba(0,0,0,0.92)' }]}>
        {/* Confetti layer — non-interactive */}
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          {pieces.map((piece, idx) => {
            const rotateDeg = piece.rotate.interpolate({
              inputRange: [0, 360],
              outputRange: ['0deg', '360deg'],
            });
            return (
              <Animated.View
                key={idx}
                style={{
                  position: 'absolute',
                  left: piece.startX,
                  top: 0,
                  width: piece.size,
                  height: piece.size * 1.4,
                  borderRadius: piece.size * 0.2,
                  backgroundColor: piece.color,
                  opacity: piece.opacity,
                  transform: [
                    { translateY: piece.y },
                    { translateX: piece.x },
                    { rotate: rotateDeg },
                  ],
                }}
              />
            );
          })}
        </View>

        {/* Main content */}
        <View style={styles.content}>
          <Text style={styles.partyEmoji}>{current.emoji || '🎉'}</Text>

          <Text style={[styles.headline, { color: colors.text }]}>{current.title}</Text>

          {current.subtitle ? (
            <View style={[styles.messageCard, { backgroundColor: colors.surface, ...shadow.lg }]}>
              <Text style={[styles.message, { color: colors.text }]}>{current.subtitle}</Text>
            </View>
          ) : null}

          <Text style={styles.pawAccents}>🐾  🐶  🐾</Text>

          {current.actionLabel && current.onAction && (
            <TouchableOpacity
              style={[styles.button, { backgroundColor: colors.primary, marginBottom: spacing.sm }]}
              onPress={() => { handleDismiss(); current.onAction?.(); }}
              accessibilityRole="button"
              accessibilityLabel={current.actionLabel}
            >
              <Text style={styles.buttonText}>{current.actionLabel}</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[styles.button, { backgroundColor: current.actionLabel ? colors.surface : colors.primary }]}
            onPress={handleDismiss}
            accessibilityRole="button"
            accessibilityLabel={current.buttonLabel || 'Done'}
          >
            <Text style={[styles.buttonText, current.actionLabel ? { color: colors.text } : undefined]}>{current.buttonLabel || 'Done 🐾'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
  },
  partyEmoji: {
    fontSize: 82,
    marginBottom: spacing.md,
  },
  headline: {
    ...typography.h1,
    fontSize: 40,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  pawAccents: {
    fontSize: 32,
    letterSpacing: 6,
    marginBottom: spacing.xl,
  },
  messageCard: {
    borderRadius: borderRadius.lg,
    padding: spacing.xl,
    marginBottom: spacing.xl,
    width: '100%',
  },
  message: {
    ...typography.body,
    textAlign: 'center',
    lineHeight: 27,
    fontSize: 19,
  },
  button: {
    paddingVertical: spacing.md + 2,
    paddingHorizontal: spacing.xl,
    borderRadius: borderRadius.full,
    width: '100%',
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    ...typography.button,
    fontSize: 20,
  },
});

export default ConfettiCelebration;
