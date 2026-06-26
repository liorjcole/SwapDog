import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
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
import AnimatedSlide, { HOLD_SPEED, SLIDE_BACKGROUND } from '../../components/auth/AnimatedSlide';

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

// The swipeable landing carousel. Adding slide 2 & 3 is a drop-in: place
// slideN.html in assets/signin-animations and append one entry here — no other
// changes are needed. durationMs is the real loop duration measured from each
// slide's source: slide1 reads `var LOOP_MS` from the HTML; slide2 uses 10s
// CSS infinite animations; slide3 duration is the MP4 mvhd box duration.
//   slide1: LOOP_MS = 25600ms (declared in slide HTML).
//   slide2: 10s CSS animations → 10000ms.
//   slide3: MP4 video duration → 8058ms (timescale 1000, units 8058).
const SLIDES: Slide[] = [
  { key: 'slide1', source: require('../../../assets/signin-animations/slide1.html'), durationMs: 25600 }, // LOOP_MS = 25600 (single play-through: scene-two 11.6s delay + 14.0s)
  { key: 'slide2', source: require('../../../assets/signin-animations/slide2.html'), durationMs: 10000 }, // 10s CSS animations (confirmed)
  { key: 'slide3', source: require('../../../assets/signin-animations/slide3.html'), durationMs: 8058 },  // MP4 mvhd duration: 8058ms
];

// A setTimeout that survives speed changes without losing elapsed time and
// restarts cleanly whenever `resetKey` changes (i.e. a new slide is shown).
// `rate` is a playback multiplier (1 = normal, HOLD_SPEED while held): the
// countdown banks content-time = realElapsed × rate so it stays in lock-step
// with the WebView animation + progress ring as the slide fast-forwards.
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

    // rate <= 0 would pause; the carousel never uses 0 (hold = fast-forward),
    // but guard so a stray value freezes cleanly instead of dividing by zero.
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
  const { width } = useWindowDimensions();
  const [activeIndex, setActiveIndex] = useState(0);
  const [holding, setHolding] = useState(false);
  const listRef = useRef<FlatList<Slide>>(null);

  // A freshly shown slide always starts playing from the top at 1x — never
  // inherit a stale hold state from the slide we just left.
  useEffect(() => {
    setHolding(false);
  }, [activeIndex]);

  // Auto-advance once the active slide has played its full loop. Driven off the
  // per-slide duration so timing matches each animation rather than a single
  // shared interval. Loops back to slide 1 after the last slide.
  const advance = useCallback(() => {
    const next = (activeIndex + 1) % SLIDES.length;
    listRef.current?.scrollToIndex({ index: next, animated: true });
    setActiveIndex(next);
  }, [activeIndex]);

  // Holding fast-forwards the countdown at the same multiplier the WebView uses
  // for the animation + ring, so they all reach the advance point together.
  useRateTimeout(
    SLIDES[activeIndex]?.durationMs ?? 0,
    advance,
    activeIndex,
    holding ? HOLD_SPEED : 1,
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

  const handleHoldStart = useCallback(() => setHolding(true), []);
  const handleHoldEnd = useCallback(() => setHolding(false), []);

  const getItemLayout = useCallback(
    (_data: ArrayLike<Slide> | null | undefined, index: number) => ({
      length: width,
      offset: width * index,
      index,
    }),
    [width],
  );

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<Slide>) => (
      <View style={{ width }}>
        <AnimatedSlide
          source={item.source}
          isActive={index === activeIndex}
          holding={holding && index === activeIndex}
          loopMs={item.durationMs}
          onHoldStart={handleHoldStart}
          onHoldEnd={handleHoldEnd}
        />
      </View>
    ),
    [width, activeIndex, holding, handleHoldStart, handleHoldEnd],
  );

  const bottomPad = Math.max(insets?.bottom ?? 0, 24);

  return (
    <View style={styles.container}>
      <FlatList
        ref={listRef}
        data={SLIDES}
        keyExtractor={(item) => item.key}
        renderItem={renderItem}
        extraData={`${activeIndex}-${holding}`}
        getItemLayout={getItemLayout}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        bounces={false}
        onMomentumScrollEnd={onMomentumScrollEnd}
        scrollEnabled={SLIDES.length > 1}
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
});

export default SplashScreen;