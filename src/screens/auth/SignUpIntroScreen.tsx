import React, { useCallback, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  GestureResponderEvent,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
  type ImageSourcePropType,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { VideoView, useVideoPlayer } from 'expo-video';
import type { VideoPlayer } from 'expo-video';
import { BlurView } from 'expo-blur';
import { AuthStackParamList } from '../../navigation/types';
import { spacing } from '../../config/theme';

type Props = {
  navigation: NativeStackNavigationProp<AuthStackParamList, 'SignUpIntro'>;
};

type SignUpIntroExperienceProps = {
  onBack: () => void;
  onComplete: () => void;
};
const ONBOARDING_VIDEO_1 = require('../../../assets/onboarding/onboarding1-hevc-alpha.mov');
const ONBOARDING_VIDEO_2 = require('../../../assets/onboarding/onboarding2-hevc-alpha.mov');
const ONBOARDING_VIDEO_3 = require('../../../assets/onboarding/onboarding3-cropped-upscaled-hevc-alpha.mov');
const ONBOARDING_VIDEO_4 = require('../../../assets/onboarding/onboarding4-hevc-alpha.mov');
const POST_REQUEST_TITLE = require('../../../assets/onboarding/post-pet-care-request.png');
const BLAST_TO_OWNERS_TITLE = require('../../../assets/onboarding/blast-to-pet-owners.png');
const CHAT_CONFIRM_TITLE = require('../../../assets/onboarding/chat-confirm-helping-hand.png');
const TRADE_POINTS_TITLE = require('../../../assets/onboarding/trade-points-not-money.png');
const COIN_ANGLED_LARGE = require('../../../assets/onboarding/coin-angled-large.png');
const COIN_FRONT_LARGE = require('../../../assets/onboarding/coin-front-large.png');
const COIN_FRONT_SMALL = require('../../../assets/onboarding/coin-front-small.png');
const COIN_ANGLED_SMALL = require('../../../assets/onboarding/coin-angled-small.png');
const EARN_POINTS_WITH_EASE = require('../../../assets/onboarding/earn-points-with-ease.png');
const WORKING_FROM_HOME_POINTS = require('../../../assets/onboarding/working-from-home-points.png');
const HEADING_TO_DOG_PARK_POINTS = require('../../../assets/onboarding/heading-to-dog-park-points.png');
const INTRO_BLUR_PERCENT = 35;
const INTRO_DARK_OVERLAY_PERCENT = 55;
const TITLE_BACKDROP_BLUR_PERCENT = 35;
const TITLE_BACKDROP_DARK_OVERLAY_PERCENT = 55;
const READY_BACKDROP_DARK_OVERLAY_PERCENT = 30;
const READY_BACKDROP_DELAY_MS = 1000;
const READY_BACKDROP_FADE_MS = 650;
const INTRO_ANIMATION_SCALE_PERCENT = 144;
const INTRO_CONTENT_OFFSET_Y = 140;
const TITLE_SLAM_MS = 650;
const TITLE_HOLD_MS = 1500;
const TITLE_FADE_MS = 350;
const TITLE_START_SCALE = 3.2;
const READY_PULSE_MIN_SCALE = 0.52;
const READY_PULSE_MAX_SCALE = 1.48;
const FAST_FORWARD_EDGE_PERCENT = 15;
const FAST_FORWARD_RATE = 1.8;
const HOLD_ACTIVATION_MS = 180;
const TITLE_TOTAL_MS = TITLE_SLAM_MS + TITLE_HOLD_MS + TITLE_FADE_MS;
const COIN_BURST_MS = 750;
const THIRD_STEP_INDEX = 2;
const FOURTH_STEP_INDEX = 3;
const POINTS_EASE_MS = 5200;

type IntroPhase = 'title' | 'video' | 'coinBurst' | 'ready';
type HoldMode = 'pause' | 'fastForward';
type CustomIntroAnimation = 'pointsEase';
type CoinBurstItem = {
  source: ImageSourcePropType;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  size: number;
  rotate: string;
  delay: number;
};
type IntroStep = {
  title: ImageSourcePropType;
  video: number;
  durationSeconds: number;
  outroMs?: number;
  customAnimation?: CustomIntroAnimation;
};

const INTRO_STEPS: readonly IntroStep[] = [
  {
    title: POST_REQUEST_TITLE,
    video: ONBOARDING_VIDEO_1,
    durationSeconds: 6,
  },
  {
    title: BLAST_TO_OWNERS_TITLE,
    video: ONBOARDING_VIDEO_2,
    durationSeconds: 10,
  },
  {
    title: CHAT_CONFIRM_TITLE,
    video: ONBOARDING_VIDEO_3,
    durationSeconds: 6,
    outroMs: COIN_BURST_MS,
  },
  {
    title: TRADE_POINTS_TITLE,
    video: ONBOARDING_VIDEO_4,
    durationSeconds: POINTS_EASE_MS / 1000,
    customAnimation: 'pointsEase',
  },
] as const;
const COIN_BURST_ITEMS: CoinBurstItem[] = [
  { source: COIN_FRONT_LARGE, startX: 0, startY: 0, endX: -0.42, endY: -0.34, size: 76, rotate: '-18deg', delay: 0 },
  { source: COIN_ANGLED_LARGE, startX: 0.02, startY: 0.02, endX: 0.36, endY: -0.32, size: 68, rotate: '26deg', delay: 35 },
  { source: COIN_FRONT_SMALL, startX: -0.02, startY: 0.01, endX: -0.18, endY: -0.46, size: 54, rotate: '12deg', delay: 70 },
  { source: COIN_ANGLED_SMALL, startX: 0.01, startY: -0.01, endX: 0.16, endY: -0.44, size: 56, rotate: '-34deg', delay: 55 },
  { source: COIN_FRONT_LARGE, startX: 0, startY: 0.01, endX: -0.48, endY: 0.02, size: 64, rotate: '44deg', delay: 90 },
  { source: COIN_ANGLED_LARGE, startX: 0.01, startY: 0, endX: 0.46, endY: 0.04, size: 72, rotate: '-22deg', delay: 105 },
  { source: COIN_FRONT_SMALL, startX: -0.01, startY: 0.02, endX: -0.32, endY: 0.34, size: 50, rotate: '-8deg', delay: 130 },
  { source: COIN_ANGLED_SMALL, startX: 0.02, startY: 0.01, endX: 0.28, endY: 0.36, size: 52, rotate: '38deg', delay: 145 },
  { source: COIN_FRONT_LARGE, startX: 0, startY: 0, endX: -0.04, endY: 0.48, size: 82, rotate: '18deg', delay: 165 },
  { source: COIN_ANGLED_LARGE, startX: 0.01, startY: 0, endX: 0.08, endY: -0.1, size: 62, rotate: '-48deg', delay: 200 },
];
const POINTS_STACK_COINS = [
  { source: COIN_ANGLED_LARGE, x: 50, y: 29.54, w: 10.7, h: 5, rotate: '-18deg', at: 0.18 },
  { source: COIN_FRONT_SMALL, x: 50, y: 35.07, w: 7.4, h: 3.5, rotate: '8deg', at: 0.25 },
  { source: COIN_FRONT_LARGE, x: 50.51, y: 40.16, w: 9.7, h: 4.6, rotate: '-6deg', at: 0.34 },
  { source: COIN_ANGLED_SMALL, x: 50.51, y: 55.91, w: 7.9, h: 3.7, rotate: '-22deg', at: 0.56 },
  { source: COIN_FRONT_LARGE, x: 50.51, y: 61.29, w: 10.2, h: 4.8, rotate: '6deg', at: 0.64 },
  { source: COIN_ANGLED_SMALL, x: 50.25, y: 66.35, w: 8.1, h: 3.8, rotate: '-18deg', at: 0.70 },
];
const POINTS_SHOWER_COINS = [
  { source: COIN_FRONT_LARGE, x: -0.44, y: -0.36, endY: 0.34, size: 58, rotate: '-24deg', at: 0.82 },
  { source: COIN_ANGLED_LARGE, x: -0.22, y: -0.42, endY: 0.30, size: 50, rotate: '28deg', at: 0.84 },
  { source: COIN_FRONT_SMALL, x: 0.04, y: -0.38, endY: 0.36, size: 42, rotate: '-8deg', at: 0.86 },
  { source: COIN_ANGLED_SMALL, x: 0.30, y: -0.42, endY: 0.28, size: 44, rotate: '34deg', at: 0.88 },
  { source: COIN_FRONT_LARGE, x: 0.44, y: -0.34, endY: 0.32, size: 60, rotate: '12deg', at: 0.90 },
  { source: COIN_ANGLED_LARGE, x: -0.34, y: -0.24, endY: 0.38, size: 52, rotate: '-42deg', at: 0.91 },
  { source: COIN_FRONT_SMALL, x: 0.20, y: -0.28, endY: 0.38, size: 40, rotate: '20deg', at: 0.93 },
  { source: COIN_ANGLED_SMALL, x: -0.02, y: -0.30, endY: 0.36, size: 46, rotate: '-18deg', at: 0.95 },
];
const getStepTrackedMs = (step: IntroStep) => (
  step.durationSeconds * 1000 + (step.outroMs ?? 0)
);
const TOTAL_VIDEO_MS = INTRO_STEPS
  .reduce((sum, step) => sum + getStepTrackedMs(step), 0);
const TOTAL_TITLE_MS = INTRO_STEPS.length * TITLE_TOTAL_MS;
const TOTAL_TRACKED_MS = TOTAL_TITLE_MS + TOTAL_VIDEO_MS;
const getElapsedBeforeStep = (stepIndex: number) => {
  const previousVideoMs = INTRO_STEPS
    .slice(0, stepIndex)
    .reduce((sum, step) => sum + getStepTrackedMs(step), 0);

  return stepIndex * TITLE_TOTAL_MS + previousVideoMs;
};

const pausePlayerSafely = (videoPlayer: VideoPlayer) => {
  try {
    videoPlayer.pause();
  } catch {
    return;
  }
};

const seekPlayerSafely = (videoPlayer: VideoPlayer, seconds: number) => {
  try {
    videoPlayer.currentTime = seconds;
  } catch {
    return;
  }
};

const playPlayerSafely = (videoPlayer: VideoPlayer) => {
  try {
    videoPlayer.play();
  } catch {
    return;
  }
};

const setPlaybackRateSafely = (videoPlayer: VideoPlayer, playbackRate: number) => {
  try {
    videoPlayer.playbackRate = playbackRate;
  } catch {
    return;
  }
};

const setupIntroVideoPlayer = (videoPlayer: VideoPlayer) => {
  videoPlayer.loop = false;
  videoPlayer.muted = true;
  videoPlayer.volume = 0;
  setPlaybackRateSafely(videoPlayer, 1);
  seekPlayerSafely(videoPlayer, 0);
  pausePlayerSafely(videoPlayer);
};

export const SignUpIntroExperience: React.FC<SignUpIntroExperienceProps> = ({
  onBack,
  onComplete,
}) => {
  const insets = useSafeAreaInsets();
  const { height: screenHeight, width: screenWidth } = useWindowDimensions();
  const backgroundFade = useRef(new Animated.Value(0)).current;
  const titleBackdropOpacity = useRef(new Animated.Value(0)).current;
  const readyBackdropOpacity = useRef(new Animated.Value(0)).current;
  const titleOpacity = useRef(new Animated.Value(0)).current;
  const titleTranslateY = useRef(new Animated.Value(0)).current;
  const titleScale = useRef(new Animated.Value(TITLE_START_SCALE)).current;
  const animationOpacity = useRef(new Animated.Value(0)).current;
  const finalCtaOpacity = useRef(new Animated.Value(0)).current;
  const exitOpacity = useRef(new Animated.Value(1)).current;
  const progress = useRef(new Animated.Value(0)).current;
  const totalProgress = useRef(new Animated.Value(0)).current;
  const pulseScale = useRef(new Animated.Value(1)).current;
  const coinBurstProgress = useRef(new Animated.Value(0)).current;
  const animationFadeRef = useRef<Animated.CompositeAnimation | undefined>(undefined);
  const readyBackdropAnimationRef = useRef<Animated.CompositeAnimation | undefined>(undefined);
  const progressAnimationRef = useRef<Animated.CompositeAnimation | undefined>(undefined);
  const totalProgressAnimationRef = useRef<Animated.CompositeAnimation | undefined>(undefined);
  const pulseAnimationRef = useRef<Animated.CompositeAnimation | undefined>(undefined);
  const coinBurstAnimationRef = useRef<Animated.CompositeAnimation | undefined>(undefined);
  const stepTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const readyBackdropTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const holdActivationTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const titleSequenceRef = useRef<Animated.CompositeAnimation | undefined>(undefined);
  const playersRef = useRef<VideoPlayer[]>([]);
  const activeStepIndexRef = useRef(0);
  const phaseRef = useRef<IntroPhase>('title');
  const isHoldingRef = useRef(false);
  const holdModeRef = useRef<HoldMode | undefined>(undefined);
  const pausedProgressRef = useRef(0);
  const pausedTotalProgressRef = useRef(0);
  const [isStepReady, setIsStepReady] = useState(false);
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [introPhase, setIntroPhase] = useState<IntroPhase>('title');
  const [isExiting, setIsExiting] = useState(false);
  const player1 = useVideoPlayer(ONBOARDING_VIDEO_1, setupIntroVideoPlayer);
  const player2 = useVideoPlayer(ONBOARDING_VIDEO_2, setupIntroVideoPlayer);
  const player3 = useVideoPlayer(ONBOARDING_VIDEO_3, setupIntroVideoPlayer);
  const player4 = useVideoPlayer(ONBOARDING_VIDEO_4, setupIntroVideoPlayer);
  playersRef.current = [player1, player2, player3, player4];

  const getStepPlayer = useCallback((stepIndex: number) => (
    playersRef.current[stepIndex] ?? playersRef.current[0] ?? player1
  ), [player1]);

  const pauseAllPlayers = useCallback(() => {
    playersRef.current.forEach((videoPlayer) => {
      setPlaybackRateSafely(videoPlayer, 1);
      pausePlayerSafely(videoPlayer);
    });
  }, []);

  const resetPlayerToStart = useCallback((videoPlayer: VideoPlayer) => {
    setPlaybackRateSafely(videoPlayer, 1);
    seekPlayerSafely(videoPlayer, 0);
    pausePlayerSafely(videoPlayer);
  }, []);

  const clearStepTimer = useCallback(() => {
    if (stepTimerRef.current) {
      clearTimeout(stepTimerRef.current);
      stepTimerRef.current = undefined;
    }
  }, []);

  const clearReadyBackdropTimer = useCallback(() => {
    if (readyBackdropTimerRef.current) {
      clearTimeout(readyBackdropTimerRef.current);
      readyBackdropTimerRef.current = undefined;
    }
  }, []);

  const clearHoldActivationTimer = useCallback(() => {
    if (holdActivationTimerRef.current) {
      clearTimeout(holdActivationTimerRef.current);
      holdActivationTimerRef.current = undefined;
    }
  }, []);

  const startReadyPulse = useCallback(() => {
    pulseAnimationRef.current?.stop();
    pulseAnimationRef.current = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseScale, {
          toValue: READY_PULSE_MAX_SCALE,
          duration: 850,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulseScale, {
          toValue: READY_PULSE_MIN_SCALE,
          duration: 850,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
      { resetBeforeIteration: false },
    );
    pulseAnimationRef.current.start();
  }, [pulseScale]);

  const enterReadyState = useCallback((stepIndex: number) => {
    progress.setValue(1);
    pulseScale.setValue(1);
    coinBurstProgress.setValue(0);
    setIsStepReady(true);
    phaseRef.current = 'ready';
    setIntroPhase('ready');
    readyBackdropAnimationRef.current?.stop();
    readyBackdropOpacity.setValue(0);
    clearReadyBackdropTimer();
    readyBackdropTimerRef.current = setTimeout(() => {
      readyBackdropAnimationRef.current = Animated.timing(readyBackdropOpacity, {
        toValue: 1,
        duration: READY_BACKDROP_FADE_MS,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      });
      readyBackdropAnimationRef.current.start();
    }, READY_BACKDROP_DELAY_MS);
    if (stepIndex === INTRO_STEPS.length - 1) {
      Animated.timing(finalCtaOpacity, {
        toValue: 1,
        duration: 360,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start();
    } else {
      finalCtaOpacity.setValue(0);
    }
    startReadyPulse();
  }, [
    clearReadyBackdropTimer,
    coinBurstProgress,
    finalCtaOpacity,
    progress,
    pulseScale,
    readyBackdropOpacity,
    startReadyPulse,
  ]);

  const finishVideoStep = useCallback(() => {
    const stepIndex = activeStepIndexRef.current;
    const step = INTRO_STEPS[stepIndex];
    const videoPlayer = getStepPlayer(stepIndex);
    if (!step.customAnimation) {
      setPlaybackRateSafely(videoPlayer, 1);
      seekPlayerSafely(videoPlayer, step.durationSeconds);
      pausePlayerSafely(videoPlayer);
    }

    if (step.outroMs) {
      const totalStepEnd = (
        getElapsedBeforeStep(stepIndex) + TITLE_TOTAL_MS + getStepTrackedMs(step)
      ) / TOTAL_TRACKED_MS;
      phaseRef.current = 'coinBurst';
      setIntroPhase('coinBurst');
      progress.setValue(0.99);
      coinBurstProgress.setValue(0);
      coinBurstAnimationRef.current?.stop();
      totalProgressAnimationRef.current?.stop();
      coinBurstAnimationRef.current = Animated.timing(coinBurstProgress, {
        toValue: 1,
        duration: step.outroMs,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      });
      totalProgressAnimationRef.current = Animated.timing(totalProgress, {
        toValue: totalStepEnd,
        duration: step.outroMs,
        easing: Easing.linear,
        useNativeDriver: false,
      });
      Animated.parallel([
        coinBurstAnimationRef.current,
        totalProgressAnimationRef.current,
      ]).start(({ finished }) => {
        if (finished && activeStepIndexRef.current === stepIndex) {
          enterReadyState(stepIndex);
        }
      });
      return;
    }

    enterReadyState(stepIndex);
  }, [
    coinBurstProgress,
    enterReadyState,
    getStepPlayer,
    progress,
    totalProgress,
  ]);

  const startVideoStep = useCallback((fromProgress = 0, playbackRate = 1) => {
    const clampedProgress = Math.max(0, Math.min(1, fromProgress));
    const clampedPlaybackRate = Math.max(0.1, playbackRate);
    const stepIndex = activeStepIndexRef.current;
    const step = INTRO_STEPS[activeStepIndexRef.current];
    const videoPlayer = getStepPlayer(stepIndex);
    const stepDurationSeconds = step.durationSeconds;
    const stepDurationMs = stepDurationSeconds * 1000;
    const remainingVideoMs = Math.max(0, (1 - clampedProgress) * stepDurationMs);
    const remainingPlaybackMs = remainingVideoMs / clampedPlaybackRate;
    const elapsedBeforeVideo = getElapsedBeforeStep(stepIndex) + TITLE_TOTAL_MS;
    const elapsedVideoProgress = clampedProgress * stepDurationMs;
    const totalProgressStart = (elapsedBeforeVideo + elapsedVideoProgress) / TOTAL_TRACKED_MS;
    const totalProgressEnd = (elapsedBeforeVideo + stepDurationMs) / TOTAL_TRACKED_MS;
    clearStepTimer();
    clearReadyBackdropTimer();
    readyBackdropAnimationRef.current?.stop();
    readyBackdropOpacity.setValue(0);
    finalCtaOpacity.setValue(0);
    coinBurstAnimationRef.current?.stop();
    coinBurstProgress.setValue(0);
    phaseRef.current = 'video';
    setIntroPhase('video');
    pauseAllPlayers();
    progress.setValue(clampedProgress);
    totalProgress.setValue(totalProgressStart);

    animationFadeRef.current?.stop();
    if (clampedProgress === 0) {
      animationOpacity.setValue(0);
      animationFadeRef.current = Animated.timing(animationOpacity, {
        toValue: 1,
        duration: 250,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      });
      animationFadeRef.current.start();
    } else {
      animationOpacity.setValue(1);
    }

    if (!step.customAnimation) {
      seekPlayerSafely(videoPlayer, clampedProgress * stepDurationSeconds);
      setPlaybackRateSafely(videoPlayer, clampedPlaybackRate);
      playPlayerSafely(videoPlayer);
    }

    progressAnimationRef.current?.stop();
    progressAnimationRef.current = Animated.timing(progress, {
      toValue: 1,
      duration: remainingPlaybackMs,
      easing: Easing.linear,
      useNativeDriver: true,
    });
    progressAnimationRef.current.start();
    totalProgressAnimationRef.current?.stop();
    totalProgressAnimationRef.current = Animated.timing(totalProgress, {
      toValue: totalProgressEnd,
      duration: remainingPlaybackMs,
      easing: Easing.linear,
      useNativeDriver: false,
    });
    totalProgressAnimationRef.current.start();

    stepTimerRef.current = setTimeout(
      finishVideoStep,
      remainingPlaybackMs,
    );
  }, [
    animationOpacity,
    clearStepTimer,
    clearReadyBackdropTimer,
    coinBurstProgress,
    finishVideoStep,
    finalCtaOpacity,
    getStepPlayer,
    pauseAllPlayers,
    progress,
    readyBackdropOpacity,
    totalProgress,
  ]);

  const startTitleSequence = useCallback(() => {
    const stepIndex = activeStepIndexRef.current;
    const elapsedBeforeTitle = getElapsedBeforeStep(stepIndex);
    const totalProgressStart = elapsedBeforeTitle / TOTAL_TRACKED_MS;
    const totalProgressEnd = (elapsedBeforeTitle + TITLE_TOTAL_MS) / TOTAL_TRACKED_MS;
    phaseRef.current = 'title';
    setIntroPhase('title');
    pauseAllPlayers();
    resetPlayerToStart(getStepPlayer(stepIndex));
    titleSequenceRef.current?.stop();
    totalProgressAnimationRef.current?.stop();
    titleOpacity.setValue(0);
    titleBackdropOpacity.setValue(0);
    readyBackdropAnimationRef.current?.stop();
    clearReadyBackdropTimer();
    readyBackdropOpacity.setValue(0);
    coinBurstAnimationRef.current?.stop();
    coinBurstProgress.setValue(0);
    finalCtaOpacity.setValue(0);
    titleTranslateY.setValue(0);
    titleScale.setValue(TITLE_START_SCALE);
    totalProgress.setValue(totalProgressStart);
    totalProgressAnimationRef.current = Animated.timing(totalProgress, {
      toValue: totalProgressEnd,
      duration: TITLE_TOTAL_MS,
      easing: Easing.linear,
      useNativeDriver: false,
    });
    totalProgressAnimationRef.current.start();
    titleSequenceRef.current = Animated.sequence([
      Animated.parallel([
        Animated.timing(titleOpacity, {
          toValue: 1,
          duration: 120,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(titleBackdropOpacity, {
          toValue: 1,
          duration: 180,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.spring(titleScale, {
          toValue: 1,
          damping: 11,
          mass: 0.72,
          stiffness: 165,
          useNativeDriver: true,
        }),
      ]),
      Animated.delay(TITLE_HOLD_MS),
      Animated.parallel([
        Animated.timing(titleOpacity, {
          toValue: 0,
          duration: TITLE_FADE_MS,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(titleBackdropOpacity, {
          toValue: 0,
          duration: TITLE_FADE_MS,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(titleTranslateY, {
          toValue: -24,
          duration: TITLE_FADE_MS,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    ]);
    titleSequenceRef.current.start(({ finished }) => {
      if (!finished || isHoldingRef.current) {
        return;
      }
      startVideoStep(0);
    });
  }, [
    startVideoStep,
    totalProgress,
    titleOpacity,
    titleBackdropOpacity,
    clearReadyBackdropTimer,
    coinBurstProgress,
    getStepPlayer,
    pauseAllPlayers,
    readyBackdropOpacity,
    resetPlayerToStart,
    titleScale,
    titleTranslateY,
  ]);

  const resetArrowForNextStep = useCallback((onComplete: () => void) => {
    pulseAnimationRef.current?.stop();
    pulseScale.setValue(1);
    clearReadyBackdropTimer();
    readyBackdropAnimationRef.current?.stop();
    readyBackdropAnimationRef.current = undefined;
    Animated.parallel([
      Animated.timing(progress, {
        toValue: 0,
        duration: 260,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(readyBackdropOpacity, {
        toValue: 0,
        duration: 260,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) {
        onComplete();
      }
    });
  }, [clearReadyBackdropTimer, progress, pulseScale, readyBackdropOpacity]);

  const restartVideoFromStoppedProgress = useCallback((playbackRate: number) => {
    clearStepTimer();
    progressAnimationRef.current?.stop();
    totalProgressAnimationRef.current?.stop();
    animationFadeRef.current?.stop();
    progress.stopAnimation((value) => {
      pausedProgressRef.current = value;
      startVideoStep(value, playbackRate);
    });
  }, [clearStepTimer, progress, startVideoStep]);

  const activateHold = useCallback((pageX: number) => {
    if (isHoldingRef.current) {
      return;
    }
    isHoldingRef.current = true;
    const isRightEdgeHold = pageX >= screenWidth * (1 - FAST_FORWARD_EDGE_PERCENT / 100);

    if (phaseRef.current === 'title') {
      holdModeRef.current = 'pause';
      titleSequenceRef.current?.stop();
      totalProgressAnimationRef.current?.stop();
      totalProgress.stopAnimation((value) => {
        pausedTotalProgressRef.current = value;
      });
      return;
    }

    if (phaseRef.current === 'video') {
      holdModeRef.current = isRightEdgeHold ? 'fastForward' : 'pause';
      if (isRightEdgeHold) {
        restartVideoFromStoppedProgress(FAST_FORWARD_RATE);
        return;
      }

      clearStepTimer();
      progressAnimationRef.current?.stop();
      totalProgressAnimationRef.current?.stop();
      animationFadeRef.current?.stop();
      progress.stopAnimation((value) => {
        pausedProgressRef.current = value;
      });
      totalProgress.stopAnimation((value) => {
        pausedTotalProgressRef.current = value;
      });
      const videoPlayer = getStepPlayer(activeStepIndexRef.current);
      setPlaybackRateSafely(videoPlayer, 1);
      pausePlayerSafely(videoPlayer);
      return;
    }

    if (phaseRef.current === 'coinBurst') {
      holdModeRef.current = 'pause';
      return;
    }

    holdModeRef.current = 'pause';
    pulseAnimationRef.current?.stop();
  }, [clearStepTimer, getStepPlayer, progress, restartVideoFromStoppedProgress, screenWidth, totalProgress]);

  const handlePressIn = useCallback((event: GestureResponderEvent) => {
    clearHoldActivationTimer();
    const pageX = event.nativeEvent.pageX;
    holdActivationTimerRef.current = setTimeout(() => {
      holdActivationTimerRef.current = undefined;
      activateHold(pageX);
    }, HOLD_ACTIVATION_MS);
  }, [activateHold, clearHoldActivationTimer]);

  const handlePressOut = useCallback(() => {
    if (holdActivationTimerRef.current) {
      clearHoldActivationTimer();
      return;
    }

    if (!isHoldingRef.current) {
      return;
    }
    isHoldingRef.current = false;
    const holdMode = holdModeRef.current;
    holdModeRef.current = undefined;

    if (phaseRef.current === 'title') {
      startTitleSequence();
      return;
    }

    if (phaseRef.current === 'video') {
      if (holdMode === 'fastForward') {
        restartVideoFromStoppedProgress(1);
        return;
      }

      startVideoStep(pausedProgressRef.current, 1);
      return;
    }

    if (phaseRef.current === 'ready') {
      startReadyPulse();
    }
  }, [clearHoldActivationTimer, restartVideoFromStoppedProgress, startReadyPulse, startTitleSequence, startVideoStep]);

  useFocusEffect(useCallback(() => {
    setIsExiting(false);
    exitOpacity.setValue(1);
    titleOpacity.setValue(0);
    titleBackdropOpacity.setValue(0);
    titleTranslateY.setValue(0);
    titleScale.setValue(TITLE_START_SCALE);
    activeStepIndexRef.current = 0;
    setActiveStepIndex(0);
    backgroundFade.setValue(0);
    clearReadyBackdropTimer();
    readyBackdropAnimationRef.current?.stop();
    readyBackdropOpacity.setValue(0);
    coinBurstAnimationRef.current?.stop();
    coinBurstProgress.setValue(0);
    animationOpacity.setValue(0);
    finalCtaOpacity.setValue(0);
    progress.setValue(0);
    pulseScale.setValue(1);
    pausedProgressRef.current = 0;
    isHoldingRef.current = false;
    holdModeRef.current = undefined;
    clearHoldActivationTimer();
    phaseRef.current = 'title';
    setIntroPhase('title');
    setIsStepReady(false);
    pauseAllPlayers();
    playersRef.current.forEach(resetPlayerToStart);
    clearStepTimer();

    Animated.timing(backgroundFade, {
      toValue: 1,
      duration: 450,
      useNativeDriver: true,
    }).start();

    startTitleSequence();

    return () => {
      clearStepTimer();
      clearReadyBackdropTimer();
      clearHoldActivationTimer();
      titleSequenceRef.current?.stop();
      animationFadeRef.current?.stop();
      readyBackdropAnimationRef.current?.stop();
      coinBurstAnimationRef.current?.stop();
      progressAnimationRef.current?.stop();
      pulseAnimationRef.current?.stop();
      totalProgressAnimationRef.current?.stop();
      pauseAllPlayers();
    };
  }, [
    animationOpacity,
    backgroundFade,
    clearHoldActivationTimer,
    clearReadyBackdropTimer,
    clearStepTimer,
    coinBurstProgress,
    exitOpacity,
    pauseAllPlayers,
    progress,
    pulseScale,
    readyBackdropOpacity,
    resetPlayerToStart,
    startTitleSequence,
    titleBackdropOpacity,
    titleOpacity,
    titleScale,
    titleTranslateY,
  ]));

  const handleBack = () => {
    if (isExiting) {
      return;
    }
    onBack();
  };

  const handleContinue = () => {
    if (!isStepReady || isExiting) {
      return;
    }
    if (activeStepIndexRef.current < INTRO_STEPS.length - 1) {
      const nextStepIndex = activeStepIndexRef.current + 1;
      setIsStepReady(false);
      resetArrowForNextStep(() => {
        activeStepIndexRef.current = nextStepIndex;
        setActiveStepIndex(nextStepIndex);
        pausedProgressRef.current = 0;
        startTitleSequence();
      });
      return;
    }
    setIsExiting(true);
    setIsStepReady(false);
    pulseAnimationRef.current?.stop();
    Animated.timing(exitOpacity, {
      toValue: 0,
      duration: 360,
      easing: Easing.inOut(Easing.quad),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        onComplete();
      }
    });
  };

  const handlePreviousStep = () => {
    if (activeStepIndexRef.current <= 0 || isExiting) {
      return;
    }
    const previousStepIndex = activeStepIndexRef.current - 1;
    setIsStepReady(false);
    isHoldingRef.current = false;
    holdModeRef.current = undefined;
    clearHoldActivationTimer();
    clearReadyBackdropTimer();
    titleSequenceRef.current?.stop();
    animationFadeRef.current?.stop();
    readyBackdropAnimationRef.current?.stop();
    coinBurstAnimationRef.current?.stop();
    pulseAnimationRef.current?.stop();
    clearStepTimer();
    progressAnimationRef.current?.stop();
    totalProgressAnimationRef.current?.stop();
    pauseAllPlayers();
    activeStepIndexRef.current = previousStepIndex;
    setActiveStepIndex(previousStepIndex);
    pausedProgressRef.current = 0;
    progress.setValue(0);
    coinBurstProgress.setValue(0);
    pulseScale.setValue(1);
    startTitleSequence();
  };

  const darkOverlayOpacity = backgroundFade.interpolate({
    inputRange: [0, 1],
    outputRange: [0, INTRO_DARK_OVERLAY_PERCENT / 100],
  });
  const buttonOpacity = progress.interpolate({
    inputRange: [0, 0.99, 1],
    outputRange: [0.3, 0.3, 1],
  });
  const arrowOpacity = finalCtaOpacity.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0],
  });
  const footerBottomPadding = insets.bottom + spacing.xl;
  const activePlayer = getStepPlayer(activeStepIndex);
  const isThirdStep = activeStepIndex === THIRD_STEP_INDEX;
  const isPointsEaseStep = activeStepIndex === FOURTH_STEP_INDEX;
  const thirdStepReframeStart = 3 / INTRO_STEPS[THIRD_STEP_INDEX].durationSeconds;
  const thirdStepReframeEnd = Math.min(thirdStepReframeStart + 0.08, 1);
  const animationPositionerStyle = isThirdStep
    ? {
        transform: [
          {
            translateY: progress.interpolate({
              inputRange: [0, thirdStepReframeStart, thirdStepReframeEnd, 1],
              outputRange: [
                INTRO_CONTENT_OFFSET_Y,
                INTRO_CONTENT_OFFSET_Y,
                220,
                220,
              ],
              extrapolate: 'clamp',
            }),
          },
          {
            scale: progress.interpolate({
              inputRange: [0, thirdStepReframeStart, thirdStepReframeEnd, 1],
              outputRange: [
                INTRO_ANIMATION_SCALE_PERCENT / 100,
                INTRO_ANIMATION_SCALE_PERCENT / 100,
                (INTRO_ANIMATION_SCALE_PERCENT * 2) / 100,
                (INTRO_ANIMATION_SCALE_PERCENT * 2) / 100,
              ],
              extrapolate: 'clamp',
            }),
          },
        ],
      }
    : isPointsEaseStep
      ? styles.customAnimationPositioner
    : styles.defaultAnimationPositioner;

  return (
    <Pressable
      style={styles.container}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      delayLongPress={0}
    >
      <Animated.View style={[styles.screenContent, { opacity: exitOpacity }]}>
      <Animated.View
        style={[styles.backgroundEffect, { opacity: backgroundFade }]}
        pointerEvents="none"
      >
        <BlurView
          intensity={INTRO_BLUR_PERCENT}
          tint="dark"
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
      <Animated.View
        style={[styles.darkOverlay, { opacity: darkOverlayOpacity }]}
        pointerEvents="none"
      />
      <View
        style={[
          styles.totalProgressTrack,
          {
            top: insets.top + spacing.xs,
          },
        ]}
        pointerEvents="none"
      >
        <Animated.View
          style={[
            styles.totalProgressFill,
            {
              width: totalProgress.interpolate({
                inputRange: [0, 1],
                outputRange: ['0%', '100%'],
              }),
            },
          ]}
        />
      </View>

      <TouchableOpacity
        onPress={handleBack}
        accessibilityLabel="Close intro"
        accessibilityRole="button"
        hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
        style={[styles.closeButton, { top: insets.top + spacing.sm + 5 }]}
      >
        <Ionicons name="close" size={30} color="#FFFFFF" />
      </TouchableOpacity>

      <View
        style={[
          styles.animationStage,
          {
            paddingTop: isPointsEaseStep ? 0 : insets.top + 76,
            paddingBottom: isPointsEaseStep ? 0 : insets.bottom + 112,
          },
        ]}
      >
        <Animated.View
          style={[
            styles.animationPositioner,
            animationPositionerStyle,
            { opacity: animationOpacity },
          ]}
          pointerEvents="none"
        >
          {isPointsEaseStep ? (
            <View style={styles.pointsEaseStage}>
              <Animated.Image
                source={EARN_POINTS_WITH_EASE}
                resizeMode="contain"
                style={[
                  styles.pointsEasePrimaryGraphic,
                  {
                    width: screenWidth * 0.82,
                    height: screenHeight * 0.064,
                    left: screenWidth * 0.5 - (screenWidth * 0.82) / 2,
                    top: screenHeight * 0.2242 - (screenHeight * 0.064) / 2,
                    opacity: progress.interpolate({
                      inputRange: [0, 0.10],
                      outputRange: [0, 1],
                      extrapolate: 'clamp',
                    }),
                    transform: [
                      {
                        scale: progress.interpolate({
                          inputRange: [0, 0.10],
                          outputRange: [0.86, 1],
                          extrapolate: 'clamp',
                        }),
                      },
                    ],
                  },
                ]}
              />
              {POINTS_STACK_COINS.map((coin, index) => {
                const start = Math.max(coin.at - 0.04, 0);
                const end = Math.min(coin.at + 0.08, 0.82);

                return (
                  <Animated.Image
                    key={`points-stack-${index}`}
                    source={coin.source}
                    resizeMode="contain"
                    style={[
                      styles.pointsStackCoin,
                      {
                        width: screenWidth * (coin.w / 100),
                        height: screenHeight * (coin.h / 100),
                        left: screenWidth * (coin.x / 100) - (screenWidth * (coin.w / 100)) / 2,
                        top: screenHeight * (coin.y / 100) - (screenHeight * (coin.h / 100)) / 2,
                        opacity: progress.interpolate({
                          inputRange: [start, coin.at, end],
                          outputRange: [0, 1, 1],
                          extrapolate: 'clamp',
                        }),
                        transform: [
                          {
                            translateY: progress.interpolate({
                              inputRange: [start, end],
                              outputRange: [-18, 0],
                              extrapolate: 'clamp',
                            }),
                          },
                          {
                            scale: progress.interpolate({
                              inputRange: [start, coin.at, end],
                              outputRange: [0.55, 1.18, 1],
                              extrapolate: 'clamp',
                            }),
                          },
                          { rotate: coin.rotate },
                        ],
                      },
                    ]}
                  />
                );
              })}
              <Animated.Image
                source={WORKING_FROM_HOME_POINTS}
                resizeMode="contain"
                style={[
                  styles.pointsEaseDetailGraphic,
                  styles.pointsEaseWorkingGraphic,
                  {
                    width: screenWidth * 0.74,
                    height: screenHeight * 0.092,
                    left: screenWidth * 0.5 - (screenWidth * 0.74) / 2,
                    top: screenHeight * 0.4759 - (screenHeight * 0.092) / 2,
                    opacity: progress.interpolate({
                      inputRange: [0, 0.40, 0.50],
                      outputRange: [0, 0, 1],
                      extrapolate: 'clamp',
                    }),
                    transform: [
                      {
                        scale: progress.interpolate({
                          inputRange: [0.40, 0.50],
                          outputRange: [0.88, 1],
                          extrapolate: 'clamp',
                        }),
                      },
                      {
                        translateY: progress.interpolate({
                          inputRange: [0.40, 0.50],
                          outputRange: [10, 0],
                          extrapolate: 'clamp',
                        }),
                      },
                    ],
                  },
                ]}
              />
              <Animated.Image
                source={HEADING_TO_DOG_PARK_POINTS}
                resizeMode="contain"
                style={[
                  styles.pointsEaseDetailGraphic,
                  styles.pointsEaseParkGraphic,
                  {
                    width: screenWidth * 0.74,
                    height: screenHeight * 0.092,
                    left: screenWidth * 0.5 - (screenWidth * 0.74) / 2,
                    top: screenHeight * 0.7341 - (screenHeight * 0.092) / 2,
                    opacity: progress.interpolate({
                      inputRange: [0, 0.70, 0.80],
                      outputRange: [0, 0, 1],
                      extrapolate: 'clamp',
                    }),
                    transform: [
                      {
                        scale: progress.interpolate({
                          inputRange: [0.70, 0.80],
                          outputRange: [0.88, 1],
                          extrapolate: 'clamp',
                        }),
                      },
                      {
                        translateY: progress.interpolate({
                          inputRange: [0.70, 0.80],
                          outputRange: [10, 0],
                          extrapolate: 'clamp',
                        }),
                      },
                    ],
                  },
                ]}
              />
              {POINTS_SHOWER_COINS.map((coin, index) => {
                const start = coin.at;
                return (
                  <Animated.Image
                    key={`points-shower-${index}`}
                    source={coin.source}
                    resizeMode="contain"
                    style={[
                      styles.pointsTrailCoin,
                      {
                        width: coin.size,
                        height: coin.size,
                        left: screenWidth / 2 - coin.size / 2,
                        top: screenHeight / 2 - coin.size / 2,
                        opacity: progress.interpolate({
                          inputRange: [0, start, Math.min(start + 0.05, 0.98), 1],
                          outputRange: [0, 0, 1, 0],
                          extrapolate: 'clamp',
                        }),
                        transform: [
                          {
                            translateX: progress.interpolate({
                              inputRange: [start, 1],
                              outputRange: [coin.x * screenWidth, coin.x * screenWidth * 0.94],
                              extrapolate: 'clamp',
                            }),
                          },
                          {
                            translateY: progress.interpolate({
                              inputRange: [start, 1],
                              outputRange: [coin.y * screenHeight, coin.endY * screenHeight],
                              extrapolate: 'clamp',
                            }),
                          },
                          {
                            scale: progress.interpolate({
                              inputRange: [start, 1],
                              outputRange: [0.74, 1.18],
                              extrapolate: 'clamp',
                            }),
                          },
                          { rotate: coin.rotate },
                        ],
                      },
                    ]}
                  />
                );
              })}
            </View>
          ) : (
            <VideoView
              key={`intro-video-${activeStepIndex}`}
              player={activePlayer}
              style={styles.animation}
              nativeControls={false}
              contentFit="contain"
              allowsFullscreen={false}
              allowsPictureInPicture={false}
              playsInline
              useExoShutter={false}
            />
          )}
        </Animated.View>
      </View>

      <View style={styles.coinBurstLayer} pointerEvents="none">
        {COIN_BURST_ITEMS.map((coin, index) => {
          const delayProgress = Math.max(coin.delay / COIN_BURST_MS, 0.001);
          const fadeInEnd = Math.min(delayProgress + 0.16, 0.82);
          const translateX = coinBurstProgress.interpolate({
            inputRange: [0, 1],
            outputRange: [
              coin.startX * screenWidth,
              coin.endX * screenWidth,
            ],
          });
          const translateY = coinBurstProgress.interpolate({
            inputRange: [0, 1],
            outputRange: [
              coin.startY * screenHeight,
              coin.endY * screenHeight,
            ],
          });
          const scale = coinBurstProgress.interpolate({
            inputRange: [0, delayProgress, 1],
            outputRange: [0.38, 0.38, 1.14],
            extrapolate: 'clamp',
          });
          const opacity = coinBurstProgress.interpolate({
            inputRange: [0, delayProgress, fadeInEnd, 1],
            outputRange: [0, 0, 1, 0],
            extrapolate: 'clamp',
          });

          return (
            <Animated.Image
              key={`${coin.rotate}-${index}`}
              source={coin.source}
              resizeMode="contain"
              style={[
                styles.coinBurstCoin,
                {
                  width: coin.size,
                  height: coin.size,
                  left: screenWidth / 2 - coin.size / 2,
                  top: screenHeight / 2 - coin.size / 2,
                  opacity,
                  transform: [
                    { translateX },
                    { translateY },
                    { scale },
                    { rotate: coin.rotate },
                  ],
                },
              ]}
            />
          );
        })}
      </View>

      <Animated.View
        style={[
          styles.readyBackdrop,
          {
            opacity: readyBackdropOpacity,
          },
        ]}
        pointerEvents="none"
      >
        <View style={styles.readyBackdropDarkOverlay} />
      </Animated.View>

      <View style={[styles.footer, { paddingBottom: footerBottomPadding }]}>
        <TouchableOpacity
          onPress={handlePreviousStep}
          accessibilityLabel="Replay previous intro step"
          accessibilityRole="button"
          style={[
            styles.previousButton,
            {
              bottom: footerBottomPadding + 11,
              left: screenWidth / 2 - 126,
              opacity: activeStepIndex > 0 && !isExiting ? 0.82 : 0,
            },
          ]}
          activeOpacity={0.76}
          disabled={activeStepIndex === 0 || isExiting}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="arrow-back" size={28} color="#FFFFFF" />
        </TouchableOpacity>
        <Animated.View
          style={[
            styles.nextButtonShell,
            {
              opacity: buttonOpacity,
              transform: [
                { scale: pulseScale },
              ],
            },
          ]}
        >
          <TouchableOpacity
            onPress={handleContinue}
            accessibilityLabel="Continue to next intro step"
            accessibilityRole="button"
            style={styles.nextButton}
            activeOpacity={isStepReady && !isExiting ? 0.85 : 1}
            disabled={!isStepReady || isExiting}
          >
            <Animated.View style={[styles.nextButtonContent, { opacity: arrowOpacity }]}>
              <Ionicons name="arrow-forward" size={30} color="#111111" />
            </Animated.View>
            <Animated.View style={[styles.nextButtonContent, { opacity: finalCtaOpacity }]}>
              <Text style={styles.doneText}>Done</Text>
            </Animated.View>
          </TouchableOpacity>
        </Animated.View>
      </View>

      <Animated.View
        style={[
          styles.titleBackdrop,
          {
            opacity: titleBackdropOpacity,
          },
        ]}
        pointerEvents="none"
      >
        <BlurView
          intensity={TITLE_BACKDROP_BLUR_PERCENT}
          tint="dark"
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.titleBackdropDarkOverlay} />
      </Animated.View>

      <View style={styles.titleLayer} pointerEvents="none">
        <Animated.View
          style={[
            styles.titleGroup,
            {
              opacity: titleOpacity,
              transform: [
                { translateY: titleTranslateY },
                { scale: titleScale },
              ],
            },
          ]}
        >
          <View style={styles.titleNumberBadge}>
            <Text style={styles.titleNumberText}>{activeStepIndex + 1}</Text>
          </View>
          <Animated.Image
            source={INTRO_STEPS[activeStepIndex].title}
            resizeMode="contain"
            style={styles.stepTitle}
          />
        </Animated.View>
      </View>
      </Animated.View>
      <View
        style={[
          styles.persistentTitle,
          {
            top: insets.top + 24,
          },
        ]}
        pointerEvents="none"
      >
        <Text style={styles.persistentTitleText}>How WatchDog Works</Text>
      </View>
    </Pressable>
  );
};

const SignUpIntroScreen: React.FC<Props> = ({ navigation }) => (
  <SignUpIntroExperience
    onBack={() => {
      if (navigation.canGoBack()) {
        navigation.goBack();
        return;
      }
      navigation.navigate('Splash');
    }}
    onComplete={() => navigation.navigate('SignUp', {})}
  />
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  screenContent: {
    ...StyleSheet.absoluteFillObject,
  },
  persistentTitle: {
    position: 'absolute',
    left: spacing.xl,
    right: spacing.xl,
    alignItems: 'center',
    zIndex: 20,
    elevation: 20,
  },
  persistentTitleText: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: 0,
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.82)',
    textShadowOffset: { width: 0, height: 3 },
    textShadowRadius: 10,
  },
  backgroundEffect: {
    ...StyleSheet.absoluteFillObject,
  },
  darkOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000000',
  },
  totalProgressTrack: {
    position: 'absolute',
    left: spacing.xl,
    right: spacing.xl,
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
    zIndex: 30,
    elevation: 30,
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  totalProgressFill: {
    height: '100%',
    borderRadius: 2,
    backgroundColor: '#FFFFFF',
  },
  closeButton: {
    position: 'absolute',
    left: spacing.lg,
    width: 34,
    height: 34,
    opacity: 0.8,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 11,
    elevation: 11,
  },
  animationStage: {
    flex: 1,
    paddingHorizontal: spacing.sm,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  titleLayer: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
    elevation: 10,
  },
  titleGroup: {
    width: '100%',
    alignItems: 'center',
  },
  titleNumberBadge: {
    width: 74,
    height: 74,
    borderRadius: 37,
    borderWidth: 4,
    borderColor: '#FFFFFF',
    backgroundColor: 'rgba(0,0,0,0.66)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.9,
    shadowRadius: 18,
    elevation: 10,
  },
  titleNumberText: {
    color: '#FFFFFF',
    fontSize: 42,
    fontWeight: '900',
    lineHeight: 48,
    textShadowColor: '#000000',
    textShadowOffset: { width: 0, height: 4 },
    textShadowRadius: 10,
  },
  titleBackdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 4,
    elevation: 4,
  },
  titleBackdropDarkOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000000',
    opacity: TITLE_BACKDROP_DARK_OVERLAY_PERCENT / 100,
  },
  readyBackdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 2,
    elevation: 2,
  },
  readyBackdropDarkOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000000',
    opacity: READY_BACKDROP_DARK_OVERLAY_PERCENT / 100,
  },
  stepTitle: {
    width: '96%',
    height: 160,
  },
  animationPositioner: {
    width: '100%',
    height: '100%',
  },
  defaultAnimationPositioner: {
    transform: [
      { translateY: INTRO_CONTENT_OFFSET_Y },
      { scale: INTRO_ANIMATION_SCALE_PERCENT / 100 },
    ],
  },
  thirdAnimationPositioner: {
    transform: [
      { translateY: 0 },
      { scale: (INTRO_ANIMATION_SCALE_PERCENT * 2) / 100 },
    ],
  },
  customAnimationPositioner: {
    transform: [
      { translateY: 0 },
      { scale: 1 },
    ],
  },
  animation: {
    width: '100%',
    height: '100%',
    backgroundColor: 'transparent',
  },
  pointsEaseStage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  pointsEasePrimaryGraphic: {
    position: 'absolute',
    top: '12%',
    width: '82%',
    height: 54,
  },
  pointsEaseDetailGraphic: {
    position: 'absolute',
    width: '74%',
    height: 78,
  },
  pointsEaseWorkingGraphic: {
    top: '39%',
  },
  pointsEaseParkGraphic: {
    top: '65%',
  },
  pointsStackCoin: {
    position: 'absolute',
  },
  pointsTrailCoin: {
    position: 'absolute',
  },
  coinBurstLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 6,
    elevation: 6,
  },
  coinBurstCoin: {
    position: 'absolute',
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    zIndex: 5,
    elevation: 5,
  },
  previousButton: {
    position: 'absolute',
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.68)',
    backgroundColor: 'rgba(0,0,0,0.26)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextButtonShell: {
    width: 74,
    height: 74,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextButton: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.34,
    shadowRadius: 18,
    elevation: 10,
  },
  nextButtonContent: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneText: {
    color: '#111111',
    fontSize: 15,
    fontWeight: '800',
  },
});

export default SignUpIntroScreen;
