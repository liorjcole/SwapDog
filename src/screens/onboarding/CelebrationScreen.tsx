import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  Animated,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ApprovalStackParamList } from '../../navigation/types';
import { useTheme } from '../../contexts/ThemeContext';
import { spacing, borderRadius, typography, shadow, SPLASH_COLOR } from '../../config/theme';

type Props = {
  navigation: NativeStackNavigationProp<ApprovalStackParamList, 'Celebration'>;
};

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const CONFETTI_COLORS = [
  SPLASH_COLOR, // primary
  '#4ECDC4', // teal (secondary)
  '#FDCB6E', // gold (warning)
  '#A29BFE', // lavender
  '#55EFC4', // mint
  '#FD79A8', // pink
  '#74B9FF', // sky blue
  '#F9CA24', // yellow
];

interface ConfettiPiece {
  x: Animated.Value;
  y: Animated.Value;
  rotate: Animated.Value;
  opacity: Animated.Value;
  color: string;
  size: number;
  isCircle: boolean;
  startX: number;
}

const NUM_PIECES = 45;

const CelebrationScreen: React.FC<Props> = ({ navigation }) => {
  const { colors } = useTheme();
  const isMounted = useRef(true);

  // Initialise pieces once
  const pieces = useRef<ConfettiPiece[]>([]);
  if (pieces.current.length === 0) {
    for (let i = 0; i < NUM_PIECES; i++) {
      pieces.current.push({
        x: new Animated.Value(0),
        y: new Animated.Value(-30),
        rotate: new Animated.Value(0),
        opacity: new Animated.Value(1),
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        size: 6 + Math.random() * 11,
        isCircle: Math.random() > 0.5,
        startX: Math.random() * SCREEN_WIDTH,
      });
    }
  }

  const runConfetti = () => {
    if (!isMounted.current) return;

    const animations = pieces.current.map((piece) => {
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
            toValue: SCREEN_HEIGHT + 60,
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
    isMounted.current = true;
    runConfetti();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    return () => {
      isMounted.current = false;
    };
  }, []);

  const handleGetStarted = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    navigation.navigate('Contract');
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Confetti layer — non-interactive */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {pieces.current.map((piece, idx) => {
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
                height: piece.isCircle ? piece.size : piece.size * 1.7,
                borderRadius: piece.isCircle ? piece.size / 2 : 3,
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
        <Text style={styles.partyEmoji}>🎉</Text>

        <Text style={[styles.headline, { color: colors.text }]}>Congratulations!</Text>

        <Text style={[styles.subHeadline, { color: colors.primary }]}>
          Welcome to the WatchDog Family
        </Text>

        <Text style={styles.pawAccents}>🐾  🐶  🐾</Text>

        <View style={[styles.messageCard, { backgroundColor: colors.surface, ...shadow.lg }]}>
          <Text style={[styles.message, { color: colors.text }]}>
            You{"'"}ve been approved to join our community of trusted pet lovers. We{"'"}re so excited to have you!
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.button, { backgroundColor: colors.primary }]}
          onPress={handleGetStarted}
          accessibilityRole="button"
          accessibilityLabel="Get started and review your membership agreement"
        >
          <Text style={styles.buttonText}>Get Started 🐾</Text>
        </TouchableOpacity>
      </View>
    </View>
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
    marginBottom: spacing.sm,
  },
  subHeadline: {
    ...typography.h2,
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

export default CelebrationScreen;
