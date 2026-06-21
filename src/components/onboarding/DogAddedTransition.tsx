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

interface DogEntry {
  name: string;
}

interface Props {
  /** The dog that was just saved (always shown with the big title) */
  dogName: string;
  /** 1-based — the dog that was just saved */
  dogNumber: number;
  /** All dogs INCLUDING the one just saved — shown as a roster when > 1 */
  allDogs: DogEntry[];
  /** What happens after the animation */
  mode: 'addAnother' | 'continue';
  /** Only used when mode='addAnother' */
  nextDogNumber?: number;
  /** Called when animation completes */
  onFinish: () => void;
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

const DogAddedTransition: React.FC<Props> = ({
  dogName, dogNumber, allDogs, mode, nextDogNumber, onFinish,
}) => {
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

  // Roster row animations (one per dog)
  const rosterAnims = useRef(
    allDogs.map(() => ({
      opacity: new Animated.Value(0),
      translateX: new Animated.Value(-20),
    }))
  ).current;

  const lineHeight = useRef(new Animated.Value(0)).current;
  const arrowOpacity = useRef(new Animated.Value(0)).current;
  const arrowTranslateY = useRef(new Animated.Value(-10)).current;
  const nextTextOpacity = useRef(new Animated.Value(0)).current;
  const nextTextScale = useRef(new Animated.Value(0.5)).current;
  const fadeOut = useRef(new Animated.Value(1)).current;

  const showRoster = allDogs.length > 1;

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

    // Build the main content sequence
    const sequence: Animated.CompositeAnimation[] = [];

    // 2. Title: "🎉 You added [dogName]!"
    sequence.push(Animated.delay(200));
    sequence.push(
      Animated.parallel([
        Animated.timing(titleOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
        Animated.spring(titleScale, { toValue: 1, friction: 6, tension: 80, useNativeDriver: true }),
      ])
    );

    // 3. Roster rows stagger in (only when multiple dogs)
    if (showRoster) {
      sequence.push(Animated.delay(400));
      rosterAnims.forEach((anim, i) => {
        sequence.push(Animated.delay(i === 0 ? 0 : 200));
        sequence.push(
          Animated.parallel([
            Animated.timing(anim.opacity, { toValue: 1, duration: 350, useNativeDriver: true }),
            Animated.timing(anim.translateX, { toValue: 0, duration: 350, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
          ])
        );
      });
    }

    // 4. Line grows down
    sequence.push(Animated.delay(showRoster ? 300 : 400));
    sequence.push(
      Animated.timing(lineHeight, { toValue: 80, duration: 600, easing: Easing.out(Easing.cubic), useNativeDriver: false })
    );

    // 5. Arrow appears
    sequence.push(
      Animated.parallel([
        Animated.timing(arrowOpacity, { toValue: 1, duration: 300, useNativeDriver: true }),
        Animated.timing(arrowTranslateY, { toValue: 0, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ])
    );

    // 6. Bottom text
    sequence.push(Animated.delay(200));
    sequence.push(
      Animated.parallel([
        Animated.timing(nextTextOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
        Animated.spring(nextTextScale, { toValue: 1, friction: 6, tension: 80, useNativeDriver: true }),
      ])
    );

    // 7. Hold + fade out
    sequence.push(Animated.delay(1200));
    sequence.push(
      Animated.timing(fadeOut, { toValue: 0, duration: 400, useNativeDriver: true })
    );

    Animated.sequence(sequence).start(() => {
      onFinish();
    });
  }, []);

  // Bottom text based on mode
  const bottomText = mode === 'continue'
    ? 'Confirm your account! ✨'
    : `Now adding your ${ordinal(nextDogNumber ?? dogNumber + 1)} dog! 🐾`;

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
        {/* "🎉 You added [dogName]!" */}
        <Animated.Text
          style={[
            styles.addedText,
            {
              opacity: titleOpacity,
              transform: [{ scale: titleScale }],
            },
          ]}
        >
          🎉 You added {dogName}!
          {showRoster && (
            <>
              {'\n'}
              <Text style={styles.addedSubText}>
                That's your {ordinal(dogNumber)} dog!
              </Text>
            </>
          )}
        </Animated.Text>

        {/* Dog roster — shows all dogs when multiple */}
        {showRoster && (
          <View style={styles.roster}>
            {allDogs.map((dog, i) => (
              <Animated.Text
                key={i}
                style={[
                  styles.rosterRow,
                  {
                    opacity: rosterAnims[i]?.opacity ?? 1,
                    transform: [{ translateX: rosterAnims[i]?.translateX ?? 0 }],
                  },
                ]}
              >
                🐾 {dog.name}
              </Animated.Text>
            ))}
          </View>
        )}

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

        {/* Bottom text — "Confirm your account!" or "Now adding your Nth dog!" */}
        <Animated.Text
          style={[
            styles.nextText,
            {
              opacity: nextTextOpacity,
              transform: [{ scale: nextTextScale }],
            },
          ]}
        >
          {bottomText}
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
    fontSize: 30,
    fontWeight: '800',
    color: '#FFFFFF',
    textAlign: 'center',
    lineHeight: 38,
  },
  addedSubText: {
    fontSize: 22,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.7)',
  },
  roster: {
    marginTop: 20,
    alignItems: 'center',
  },
  rosterRow: {
    fontSize: 22,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.85)',
    marginVertical: 4,
  },
  line: {
    width: 3,
    borderRadius: 2,
    marginTop: 16,
  },
  arrow: {
    fontSize: 22,
    color: SPLASH_COLOR,
    marginTop: 4,
  },
  nextText: {
    fontSize: 24,
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'center',
    marginTop: 12,
  },
});

export default DogAddedTransition;
