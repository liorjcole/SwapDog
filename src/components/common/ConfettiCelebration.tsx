import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, Modal, Animated, Dimensions, StyleSheet, TouchableOpacity,
} from 'react-native';
import * as Haptics from 'expo-haptics';

const { width: W, height: H } = Dimensions.get('window');
const CONFETTI_COUNT = 60;
const COLORS = ['#FF2D55', '#FFD700', '#00B894', '#0984E3', '#6C5CE7', '#FF6B6B', '#FDCB6E', '#55E6C1', '#FF9FF3', '#48DBFB'];
const SHAPES = ['\u25A0', '\u25CF', '\u25B2', '\u2605', '\u2666', '\U0001F389', '\U0001F436', '\U0001F38A'];

interface Piece {
  x: Animated.Value;
  y: Animated.Value;
  rotate: Animated.Value;
  opacity: Animated.Value;
  color: string;
  shape: string;
  size: number;
}

export interface CelebrationItem {
  title: string;
  subtitle?: string;
  emoji?: string;
  actionLabel?: string;   // e.g. "Invite more?"
  onAction?: () => void;  // called when actionLabel button is tapped
}

interface Props {
  queue: CelebrationItem[];
  onDismissAll: () => void;
}

const ConfettiCelebration: React.FC<Props> = ({ queue, onDismissAll }) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [pieces] = useState<Piece[]>(() =>
    Array.from({ length: CONFETTI_COUNT }, () => ({
      x: new Animated.Value(W / 2),
      y: new Animated.Value(-50),
      rotate: new Animated.Value(0),
      opacity: new Animated.Value(1),
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      shape: SHAPES[Math.floor(Math.random() * SHAPES.length)],
      size: 10 + Math.random() * 14,
    }))
  );
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const bgOpacity = useRef(new Animated.Value(0)).current;

  const current = queue[currentIndex];
  const visible = queue.length > 0 && !!current;

  useEffect(() => {
    if (!visible) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    // Animate background
    Animated.timing(bgOpacity, { toValue: 1, duration: 300, useNativeDriver: true }).start();

    // Animate card
    scaleAnim.setValue(0);
    Animated.spring(scaleAnim, { toValue: 1, friction: 5, tension: 80, useNativeDriver: true }).start();

    // Animate confetti — all start from top center, fan out
    const centerX = W / 2;
    const anims = pieces.map((p) => {
      // Start clustered at top center with small random spread
      p.y.setValue(-20 - Math.random() * 80);
      p.x.setValue(centerX - 30 + Math.random() * 60);
      p.rotate.setValue(0);
      p.opacity.setValue(1);

      const duration = 2500 + Math.random() * 1500;
      // Fan out: each piece drifts to a random X across the full width
      const targetX = Math.random() * W;
      return Animated.parallel([
        Animated.timing(p.y, { toValue: H + 50, duration, useNativeDriver: true }),
        Animated.timing(p.x, { toValue: targetX, duration, useNativeDriver: true }),
        Animated.timing(p.rotate, { toValue: 3 + Math.random() * 5, duration, useNativeDriver: true }),
        Animated.sequence([
          Animated.delay(duration * 0.7),
          Animated.timing(p.opacity, { toValue: 0, duration: duration * 0.3, useNativeDriver: true }),
        ]),
      ]);
    });
    Animated.stagger(20, anims).start();

    // NO auto-dismiss — stays until user taps
  }, [visible, currentIndex]);

  const handleDismiss = () => {
    if (currentIndex < queue.length - 1) {
      // More celebrations in queue — show next
      Animated.timing(scaleAnim, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => {
        setCurrentIndex((i) => i + 1);
      });
    } else {
      // Last one — fade out and dismiss all
      Animated.timing(bgOpacity, { toValue: 0, duration: 250, useNativeDriver: true }).start(() => {
        setCurrentIndex(0);
        onDismissAll();
      });
    }
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="none">
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={handleDismiss}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.6)', opacity: bgOpacity }]} />

        {/* Confetti */}
        {pieces.map((p, i) => (
          <Animated.Text
            key={i}
            style={[
              styles.confettiPiece,
              {
                fontSize: p.size,
                color: p.color,
                transform: [
                  { translateX: p.x },
                  { translateY: p.y },
                  { rotate: p.rotate.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) },
                ],
                opacity: p.opacity,
              },
            ]}
          >
            {p.shape}
          </Animated.Text>
        ))}

        {/* Card */}
        <Animated.View style={[styles.card, { transform: [{ scale: scaleAnim }] }]}>
          <Text style={styles.cardEmoji}>{current.emoji || '\U0001F389'}</Text>
          <Text style={styles.cardTitle}>{current.title}</Text>
          {current.subtitle ? <Text style={styles.cardSubtitle}>{current.subtitle}</Text> : null}
          {current.actionLabel && current.onAction && (
            <TouchableOpacity
              onPress={() => { handleDismiss(); current.onAction?.(); }}
              style={styles.actionBtn}
              accessibilityLabel={current.actionLabel}
              accessibilityRole="button"
            >
              <Text style={styles.actionBtnText}>{current.actionLabel}</Text>
            </TouchableOpacity>
          )}
          {queue.length > 1 && (
            <Text style={styles.queueHint}>
              {currentIndex + 1} of {queue.length} — tap to continue
            </Text>
          )}
        </Animated.View>
      </TouchableOpacity>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  confettiPiece: { position: 'absolute' },
  card: {
    backgroundColor: '#1C1C1E',
    borderRadius: 24,
    paddingVertical: 36,
    paddingHorizontal: 32,
    alignItems: 'center',
    maxWidth: W * 0.85,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 10,
  },
  cardEmoji: { fontSize: 56, marginBottom: 12 },
  cardTitle: { fontSize: 24, fontWeight: '800', color: '#fff', textAlign: 'center', marginBottom: 8 },
  cardSubtitle: { fontSize: 16, color: 'rgba(255,255,255,0.7)', textAlign: 'center', lineHeight: 22 },
  actionBtn: { marginTop: 16, backgroundColor: '#FF2D55', borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12 },
  actionBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  queueHint: { fontSize: 12, color: 'rgba(255,255,255,0.4)', textAlign: 'center', marginTop: 16 },
});

export default ConfettiCelebration;
