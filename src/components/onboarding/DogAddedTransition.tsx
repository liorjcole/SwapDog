import React, { useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, Animated, Dimensions, Easing,
} from 'react-native';
import { SPLASH_COLOR, colors as themeColors } from '../../config/theme';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

const CONFETTI_COLORS = [
  SPLASH_COLOR,          // hot pink-red #FF2D55
  themeColors.secondary, // teal #4ECDC4
  '#FF6B81',             // light pink
  '#FFD93D',             // gold
  '#6C5CE7',             // purple
  '#A8E6CF',             // mint
];

const NUM_CONFETTI = 40;

interface Props {
  dogName: string;
  dogNumber: number;      // 1-based — the dog that was just saved
  nextDogNumber: number;  // the dog they're about to add
  onFinish: () => void;   // called when animation completes
}

const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

interface ConfettiPiece {
  x: number;
  delay: number;
  color: string;
  size: number;
  rotation: number;
  animY: Animated.Value;
  animX: Animated.Value;
  animOpacity: Animated.Value;
  animRotate: Animated.Value;
}

const DogAddedTransition: React.FC<Props> = ({ dogName, dogNumber, nextDogNumber, onFinish }) => {
  // --- Confetti pieces ---
  const confetti = useRef<ConfettiPiece[]>(
    Array.from({ length: NUM_CONFETTI }, () => ({
      x: Math.random() * SCREEN_W,
      delay: Math.random() * 600,
      color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
      size: 6 + Math.random() * 8,
      rotation: Math.random() * 360,
      animY: new Animated.Value(-40),
      animX: new Animated.Value(0),
      animOpacity: new Animated.Value(1),
      animRotate: new Animated.Value(0),
    }))
  ).current;

  // --- Text animations ---
  const titleOpacity = useRef(new Animated.Value(0)).current;
  const titleScale = useRef(new Animated.Value(0.5)).current;
  const lineHeight = useRef(new Animated.Value(0)).current;
  const arrowOpacity = useRef(new Animated.Value(0)).current;
  const arrowTranslateY = useRef(new Animated.Value(-10)).current;
  const nextTextOpacity = useRef(new Animated.Value(0)).current;
  const nextTextScale = useRef(new Animated.Value(0.5)).current;
  const fadeOut = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // 1. Start confetti
    confetti.forEach((piece) => {
      Animated.sequence([
        Animated.delay(piece.delay),
        Animated.parallel([
          Animated.timing(piece.animY, {
            toValue: SCREEN_H + 40,
            duration: 2200 + Math.random() * 800,
            easing: Easing.bezier(0.25, 0.46, 0.45, 0.94),
            useNativeDriver: true,
          }),
          Animated.timing(piece.animX, {
            toValue: (Math.random() - 0.5) * 120,
            duration: 2200,
            useNativeDriver: true,
          }),
          Animated.timing(piece.animRotate, {
            toValue: 1,
            duration: 2200,
            useNativeDriver: true,
          }),
          Animated.sequence([
            Animated.delay(1600),
            Animated.timing(piece.animOpacity, {
              toValue: 0,
              duration: 600,
              useNativeDriver: true,
            }),
          ]),
        ]),
      ]).start();
    });

    // 2. Title fades in + scales up: "You added your first dog!"
    Animated.sequence([
      Animated.delay(200),
      Animated.parallel([
        Animated.timing(titleOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
        Animated.spring(titleScale, { toValue: 1, friction: 6, tension: 80, useNativeDriver: true }),
      ]),
      // 3. Line grows down
      Animated.delay(400),
      Animated.timing(lineHeight, { toValue: 80, duration: 600, easing: Easing.out(Easing.cubic), useNativeDriver: false }),
      // 4. Arrow appears
      Animated.parallel([
        Animated.timing(arrowOpacity, { toValue: 1, duration: 300, useNativeDriver: true }),
        Animated.timing(arrowTranslateY, { toValue: 0, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]),
      // 5. "Now adding your second dog!" fades in
      Animated.delay(200),
      Animated.parallel([
        Animated.timing(nextTextOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
        Animated.spring(nextTextScale, { toValue: 1, friction: 6, tension: 80, useNativeDriver: true }),
      ]),
      // 6. Hold for a moment
      Animated.delay(1000),
      // 7. Fade everything out
      Animated.timing(fadeOut, { toValue: 0, duration: 400, useNativeDriver: true }),
    ]).start(() => {
      onFinish();
    });
  }, []);

  return (
    <Animated.View style={[styles.overlay, { opacity: fadeOut }]}>
      {/* Confetti */}
      {confetti.map((piece, i) => {
        const rotate = piece.animRotate.interpolate({
          inputRange: [0, 1],
          outputRange: [`${piece.rotation}deg`, `${piece.rotation + 360 + Math.random() * 360}deg`],
        });
        return (
          <Animated.View
            key={i}
            style={[
              styles.confetti,
              {
                left: piece.x,
                width: piece.size,
                height: piece.size * 1.4,
                backgroundColor: piece.color,
                borderRadius: piece.size * 0.2,
                opacity: piece.animOpacity,
                transform: [
                  { translateY: piece.animY },
                  { translateX: piece.animX },
                  { rotate },
                ],
              },
            ]}
          />
        );
      })}

      {/* Center content */}
      <View style={styles.center}>
        {/* "You added your first dog!" */}
        <Animated.Text
          style={[
            styles.addedText,
            {
              opacity: titleOpacity,
              transform: [{ scale: titleScale }],
            },
          ]}
        >
          🎉 You added {dogName}!{'\n'}
          <Text style={styles.addedSubText}>
            That's your {ordinal(dogNumber)} dog!
          </Text>
        </Animated.Text>

        {/* Animated line */}
        <Animated.View
          style={[
            styles.line,
            { height: lineHeight, backgroundColor: SPLASH_COLOR },
          ]}
        />

        {/* Arrow */}
        <Animated.Text
          style={[
            styles.arrow,
            {
              opacity: arrowOpacity,
              transform: [{ translateY: arrowTranslateY }],
            },
          ]}
        >
          ▼
        </Animated.Text>

        {/* "Now adding your second dog!" */}
        <Animated.Text
          style={[
            styles.nextText,
            {
              opacity: nextTextOpacity,
              transform: [{ scale: nextTextScale }],
            },
          ]}
        >
          Now adding your {ordinal(nextDogNumber)} dog! 🐾
        </Animated.Text>
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.92)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 999,
  },
  confetti: {
    position: 'absolute',
    top: -20,
  },
  center: {
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  addedText: {
    fontSize: 28,
    fontWeight: '800',
    color: '#FFFFFF',
    textAlign: 'center',
    lineHeight: 38,
  },
  addedSubText: {
    fontSize: 20,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.7)',
  },
  line: {
    width: 3,
    borderRadius: 2,
    marginTop: 16,
  },
  arrow: {
    fontSize: 20,
    color: SPLASH_COLOR,
    marginTop: 4,
  },
  nextText: {
    fontSize: 22,
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'center',
    marginTop: 12,
  },
});

export default DogAddedTransition;
