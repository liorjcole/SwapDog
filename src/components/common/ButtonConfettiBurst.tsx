import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

// Matches the shared confetti palette in ConfettiCelebration & DogAddedTransition.
const CONFETTI_COLORS = [
  '#FF2D55', // hot pink-red (SPLASH_COLOR)
  '#4ECDC4', // teal
  '#FF6B81', // light pink
  '#FFD93D', // gold
  '#6C5CE7', // purple
  '#A8E6CF', // mint
];

const NUM_PIECES = 18;
/** Total burst animation duration in ms. */
const DURATION = 900;

interface ConfettiPiece {
  translateX: Animated.Value;
  translateY: Animated.Value;
  rotate: Animated.Value;
  opacity: Animated.Value;
  color: string;
  size: number;
  /** Pre-computed radial target position (x axis). */
  targetX: number;
  /** Pre-computed radial target position (y axis, gravity-biased downward). */
  targetY: number;
  /** Pre-computed end rotation in degrees. */
  targetRotation: number;
}

interface Props {
  /** Called once the animation completes. */
  onDone?: () => void;
}

/**
 * A brief confetti burst that radiates from the centre of its parent.
 *
 * Usage: wrap the parent in `position: 'relative'` and remount this component
 * via a changing `key` to replay.
 */
const ButtonConfettiBurst: React.FC<Props> = ({ onDone }) => {
  // Pieces are created once per mount; remounting (via key) resets them.
  const pieces = useRef<ConfettiPiece[]>(
    Array.from({ length: NUM_PIECES }, () => {
      const angle = Math.random() * 2 * Math.PI;
      const distance = 40 + Math.random() * 50; // 40–90 px spray radius
      return {
        translateX: new Animated.Value(0),
        translateY: new Animated.Value(0),
        rotate: new Animated.Value(0),
        opacity: new Animated.Value(1),
        color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
        size: 5 + Math.random() * 4, // 5–9 px
        targetX: Math.cos(angle) * distance,
        // Slight downward gravity bias: +18 px to the y component.
        targetY: Math.sin(angle) * distance + 18,
        targetRotation:
          (Math.random() > 0.5 ? 1 : -1) * (120 + Math.random() * 240),
      };
    })
  ).current;

  useEffect(() => {
    const animations = pieces.map((piece) =>
      Animated.parallel([
        Animated.timing(piece.translateX, {
          toValue: piece.targetX,
          duration: DURATION,
          useNativeDriver: true,
        }),
        Animated.timing(piece.translateY, {
          toValue: piece.targetY,
          duration: DURATION,
          useNativeDriver: true,
        }),
        Animated.timing(piece.rotate, {
          toValue: 1,
          duration: DURATION,
          useNativeDriver: true,
        }),
        // Full opacity for first 60 %, then fade to 0.
        Animated.sequence([
          Animated.timing(piece.opacity, {
            toValue: 1,
            duration: DURATION * 0.6,
            useNativeDriver: true,
          }),
          Animated.timing(piece.opacity, {
            toValue: 0,
            duration: DURATION * 0.4,
            useNativeDriver: true,
          }),
        ]),
      ])
    );

    Animated.parallel(animations).start(() => {
      onDone?.();
    });
  }, []);

  return (
    // absoluteFill + pointerEvents="none" so the burst never blocks any touch.
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {/* Centre all pieces so they radiate from the button's midpoint. */}
      <View style={styles.center}>
        {pieces.map((piece, i) => {
          const rotateDeg = piece.rotate.interpolate({
            inputRange: [0, 1],
            outputRange: ['0deg', `${piece.targetRotation}deg`],
          });
          return (
            <Animated.View
              key={i}
              style={[
                styles.piece,
                {
                  width: piece.size,
                  height: piece.size * 1.4,
                  borderRadius: piece.size * 0.2,
                  backgroundColor: piece.color,
                  opacity: piece.opacity,
                  transform: [
                    { translateX: piece.translateX },
                    { translateY: piece.translateY },
                    { rotate: rotateDeg },
                  ],
                },
              ]}
            />
          );
        })}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  piece: {
    position: 'absolute',
  },
});

export default ButtonConfettiBurst;

