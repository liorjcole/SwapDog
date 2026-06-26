import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  FlatList,
  Image,
  ListRenderItemInfo,
  NativeScrollEvent,
  NativeSyntheticEvent,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AuthStackParamList } from '../../navigation/types';
import AnimatedSlide, { HOLD_SPEED, SLIDE_BACKGROUND, HoldMode } from '../../components/auth/AnimatedSlide';

type Props = {
  navigation: NativeStackNavigationProp<AuthStackParamList, 'Splash'>;
};

type Slide = {
  key: string;
  // A bundled .html asset module reference.
  source: number;
  // Full-loop length of this slide's animation, measured from its HTML. The
  // carousel auto-advances once this elapses so each slide plays through once.
  durationMs: number;
};

// The swipeable landing carousel. Adding a 4th slide is a drop-in: author one
// contract-compliant slideN.html (window.__slide with a matching durationMs;
// see assets/signin-animations/README.md), place it in assets/signin-animations
// and append one entry here — no host changes needed. durationMs MUST equal the
// slide's window.__slide.durationMs: it is the single-play length the contract
// loops on, and it drives both auto-advance and the progress ring.
//   slide1: 22000ms (single play-through: 22s master scene cycle).
//   slide2: 10000ms (10s CSS timeline).
//   slide3: 8058ms (MP4 video duration; timescale 1000, units 8058).

// "Press for 2x" note placement — screen fractions copied verbatim from AnimatedSlide.
// The note now lives in the fixed overlay so it never pages with the slides.
const NOTE_FADE_MS = 1000;
const NOTE_WIDTH_FRAC = 0.211; // × window width (~83pt at 393w)
const NOTE_TOP_FRAC = 0.325; // × window height
const NOTE_RIGHT_FRAC = -0.025; // × window width (negative: hangs ~10pt off right edge)
const NOTE_ASPECT = 957 / 638; // image natural aspect (w/h ≈ 1.5)

const SLIDES: Slide[] = [
  { key: 'slide1', source: require('../../../assets/signin-animations/slide1.html'), durationMs: 22000 },
  { key: 'slide2', source: require('../../../assets/signin-animations/slide2.html'), durationMs: 10000 },
  { key: 'slide3', source: require('../../../assets/signin-animations/slide3.html'), durationMs: 8058 },
];

// A setTimeout that survives speed changes without losing elapsed time and
// restarts cleanly whenever `resetKey` changes (i.e. a new slide is shown).
// `rate` is a playback multiplier (1 = normal, HOLD_SPEED while fast-forwarding,
// 0 while paused): the countdown banks content-time = realElapsed × rate so it
// stays in lock-step with the WebView animation + progress ring as the slide
// fast-forwards, and freezes (no time consumed) while paused.
function useRateTimeout(
  durationMs: number,
  onElapsed: () => void,
  resetKey: unknown,
  rate: number,
) {
  const onElapsedRef = useRef(onElapsed);
  onElapsedRef.current = onElapsed;

  // Content-ms left to play, independent of the current rate.
  const remainingRef = useRef(durationMs);
  const startedAtRef = useRef<number | null>(null);
  // The rate that was in effect during the segment now ending — used to bank
  // how much content-time that segment consumed.
  const rateRef = useRef(rate);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keyRef = useRef(resetKey);

  useEffect(() => {
    const clear = () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };

    // A new slide resets the countdown to its full duration.
    if (keyRef.current !== resetKey) {
      keyRef.current = resetKey;
      remainingRef.current = durationMs;
      startedAtRef.current = null;
    }

    // Bank the content-time consumed by the segment that just ended.
    if (startedAtRef.current != null) {
      remainingRef.current -= (Date.now() - startedAtRef.current) * rateRef.current;
      startedAtRef.current = null;
    }
    rateRef.current = rate;

    // rate <= 0 pauses (press-elsewhere): freeze the countdown in place with the
    // banked remaining time and consume no content-time until the rate rises.
    if (rate <= 0) {
      clear();
      return clear;
    }

    startedAtRef.current = Date.now();
    const realDelay = Math.max(0, remainingRef.current) / rate;
    clear();
    timeoutRef.current = setTimeout(() => {
      onElapsedRef.current();
    }, realDelay);

    return clear;
  }, [resetKey, rate, durationMs]);
}

const SplashScreen: React.FC<Props> = ({ navigation }) => {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [activeIndex, setActiveIndex] = useState(0);
  const [holdMode, setHoldMode] = useState<HoldMode>('idle');
  const listRef = useRef<FlatList<Slide>>(null);
  // Opacity for the "Press for 2x" note: visible at rest, fades out on 2x-hold.
  const noteOpacity = useRef(new Animated.Value(1)).current;

  // A freshly shown slide always starts playing from the top at 1x — never
  // inherit a stale press state from the slide we just left.
  useEffect(() => {
    setHoldMode('idle');
  }, [activeIndex]);

  // Fade the note out while fast-forwarding; restore on release or slide change.
  useEffect(() => {
    Animated.timing(noteOpacity, {
      toValue: holdMode === 'fast' ? 0 : 1,
      duration: NOTE_FADE_MS,
      useNativeDriver: true,
    }).start();
  }, [holdMode, noteOpacity]);

  // Auto-advance once the active slide has played its full loop. Driven off the
  // per-slide duration so timing matches each animation rather than a single
  // shared interval. Loops back to slide 1 after the last slide.
  const advance = useCallback(() => {
    const next = (activeIndex + 1) % SLIDES.length;
    listRef.current?.scrollToIndex({ index: next, animated: true });
    setActiveIndex(next);
  }, [activeIndex]);

  // The press region maps to the auto-advance rate so the countdown stays in
  // lock-step with the WebView animation + ring: fast-forward → HOLD_SPEED,
  // pause-elsewhere → 0 (frozen), idle → 1x.
  const rate = holdMode === 'fast' ? HOLD_SPEED : holdMode === 'pause' ? 0 : 1;
  useRateTimeout(
    SLIDES[activeIndex]?.durationMs ?? 0,
    advance,
    activeIndex,
    rate,
  );

  const onMomentumScrollEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const offsetX = event?.nativeEvent?.contentOffset?.x ?? 0;
      const next = width > 0 ? Math.round(offsetX / width) : 0;
      // Manual swipe: realign the active slide (which resets its auto-advance
      // timer + ring and restarts the landed-on slide's animation from the top).
      setActiveIndex(next);
    },
    [width],
  );

  const handleHoldStart = useCallback((mode: HoldMode) => setHoldMode(mode), []);
  const handleHoldEnd = useCallback(() => setHoldMode('idle'), []);

  const getItemLayout = useCallback(
    (_data: ArrayLike<Slide> | null | undefined, index: number) => ({
      length: width,
      offset: width * index,
      index,
    }),
    [width],
  );

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<Slide>) => {
      // Windowing: only the active slide and its immediate neighbours mount a
      // live WebView. Off-window slides render a plain red placeholder so the
      // heavy WebViews are bounded (paired with the FlatList window props).
      const mounted = Math.abs(index - activeIndex) <= 1;
      return (
        <View style={{ width }}>
          {mounted ? (
            <AnimatedSlide
              source={item.source}
              isActive={index === activeIndex}
              holdMode={index === activeIndex ? holdMode : 'idle'}
              loopMs={item.durationMs}
              onHoldStart={handleHoldStart}
              onHoldEnd={handleHoldEnd}
            />
          ) : (
            <View style={styles.placeholder} />
          )}
        </View>
      );
    },
    [width, activeIndex, holdMode, handleHoldStart, handleHoldEnd],
  );

  // Note dimensions — exact same fractions as the original AnimatedSlide placement.
  const noteWidth = NOTE_WIDTH_FRAC * width;
  const noteHeight = noteWidth / NOTE_ASPECT;
  const noteTop = NOTE_TOP_FRAC * height;
  const noteRight = NOTE_RIGHT_FRAC * width;

  const bottomPad = Math.max(insets?.bottom ?? 0, 24);

  return (
    <View style={styles.container}>
      <FlatList
        ref={listRef}
        data={SLIDES}
        keyExtractor={(item) => item.key}
        renderItem={renderItem}
        extraData={`${activeIndex}-${holdMode}`}
        getItemLayout={getItemLayout}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        bounces={false}
        onMomentumScrollEnd={onMomentumScrollEnd}
        scrollEnabled={SLIDES.length > 1}
        // Mount discipline: keep at most the active slide ± 1 live so three
        // heavy WebViews never co-exist and WKWebView stays within its
        // per-content-process memory budget on-device.
        initialNumToRender={1}
        maxToRenderPerBatch={2}
        windowSize={3}
        removeClippedSubviews
      />

      {/* "Press for 2x speed" note: single instance in the fixed overlay so it
          never scrolls with slides. Fades out on 2x-hold, back in on release.
          pointerEvents="none" keeps it entirely out of the touch path. */}
      <Animated.Image
        source={require('../../../assets/signin-animations/press-for-2x.png')}
        style={{ position: 'absolute', top: noteTop, right: noteRight, width: noteWidth, height: noteHeight, opacity: noteOpacity }}
        resizeMode="contain"
        pointerEvents="none"
      />

      <View style={[styles.overlay, { paddingBottom: bottomPad + 16 }]} pointerEvents="box-none">
        {SLIDES.length > 1 && (
          <View style={styles.dots}>
            {SLIDES.map((slide, index) => (
              <View
                key={slide.key}
                style={[styles.dot, index === activeIndex ? styles.dotActive : styles.dotInactive]}
              />
            ))}
          </View>
        )}

        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={[styles.button, styles.buttonOutline]}
            activeOpacity={0.85}
            onPress={() => navigation?.navigate('SignIn')}
            accessibilityRole="button"
            accessibilityLabel="Sign In"
          >
            <Text style={styles.buttonText}>Sign In</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, styles.buttonSolid]}
            activeOpacity={0.85}
            onPress={() => navigation?.navigate('SignUp', {})}
            accessibilityRole="button"
            accessibilityLabel="Sign Up"
          >
            <Text style={styles.buttonText}>Sign Up</Text>
          </TouchableOpacity>
        </View>

        {/* Permanent WatchDog wordmark: the bottom-most element of the fixed
            overlay, identical across every slide. pointerEvents="none" keeps it
            out of the touch path so paging / hold-for-2x / pause stay intact. */}
        <Image
          source={require('../../../assets/watchdog-wordmark.png')}
          style={styles.wordmark}
          resizeMode="contain"
          pointerEvents="none"
          accessibilityRole="image"
          accessibilityLabel="WatchDog"
        />
      </View>
    </View>
  );
};

// Matches the `height` in styles.button below — used to compute the nudge offset.
const BUTTON_HEIGHT = 54;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: SLIDE_BACKGROUND },
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  dots: { flexDirection: 'row', marginBottom: 20 },
  placeholder: { flex: 1, backgroundColor: SLIDE_BACKGROUND },
  dot: { width: 8, height: 8, borderRadius: 4, marginHorizontal: 4 },
  dotActive: { backgroundColor: '#FFFFFF' },
  dotInactive: { backgroundColor: 'rgba(255,255,255,0.4)' },
  // marginBottom lifts the row by half the button height so it sits higher
  // without changing its horizontal layout or the safe-area padding below.
  buttonRow: { flexDirection: 'row', width: '100%', gap: 12, marginBottom: BUTTON_HEIGHT / 2 },
  button: {
    flex: 1,
    height: BUTTON_HEIGHT,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonSolid: { backgroundColor: 'rgba(255,255,255,0.18)' },
  buttonOutline: { borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.9)' },
  buttonText: { fontSize: 18, fontWeight: '600', color: '#FFFFFF' },
  // Centered wordmark below the buttons. Explicit width+height (160×46) to
  // prevent RN/Yoga from falling back to the PNG's intrinsic 934px width.
  // Dimensions preserve the 934:270 aspect ratio: round(160×270/934) = 46.
  wordmark: { width: 160, height: 46, alignSelf: 'center' },
});

export default SplashScreen;