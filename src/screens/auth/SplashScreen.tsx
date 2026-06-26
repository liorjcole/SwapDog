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
import AnimatedSlide, { SLIDE_BACKGROUND } from '../../components/auth/AnimatedSlide';

type Props = {
  navigation: NativeStackNavigationProp<AuthStackParamList, 'Splash'>;
};

type Slide = {
  key: string;
  // A bundled .html asset module reference.
  source: number;
  // Full-loop length of this slide's animation, measured from its HTML. The
  // carousel auto-advances once this elapses so each slide plays through once,
  // and the same value drives the per-slide progress ring inside AnimatedSlide.
  durationMs: number;
};

// The swipeable landing carousel. Adding slide 2 & 3 is a drop-in: place
// slideN.html in assets/signin-animations and append one entry here — no other
// changes are needed. durationMs values are derived from each file's keyframes:
//   slide1: scene-A is a one-shot that fades out at 14.6s, then the part-two
//           reveal (animation-delay 14.6s) runs its first 14s cycle → ~28.6s;
//           rounded up to 29.5s so part two settles before we advance.
//   slide2: every keyframe is a 10s infinite loop, no delays → 10s.
//   slide3: every keyframe is a 14s infinite loop (incl. the embedded video).
const SLIDES: Slide[] = [
  { key: 'slide1', source: require('../../../assets/signin-animations/slide1.html'), durationMs: 29500 },
  { key: 'slide2', source: require('../../../assets/signin-animations/slide2.html'), durationMs: 10000 },
  { key: 'slide3', source: require('../../../assets/signin-animations/slide3.html'), durationMs: 14000 },
];

// A setTimeout that survives pause/resume without losing elapsed time and
// restarts cleanly whenever `resetKey` changes (i.e. a new slide is shown).
// Keeps the auto-advance countdown in lock-step with the held animation.
function usePausableTimeout(
  durationMs: number,
  onElapsed: () => void,
  resetKey: unknown,
  paused: boolean,
) {
  const onElapsedRef = useRef(onElapsed);
  onElapsedRef.current = onElapsed;

  const remainingRef = useRef(durationMs);
  const startedAtRef = useRef<number | null>(null);
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

    if (paused) {
      // Bank the time already spent so resume continues from here.
      if (startedAtRef.current != null) {
        remainingRef.current -= Date.now() - startedAtRef.current;
        startedAtRef.current = null;
      }
      clear();
      return clear;
    }

    startedAtRef.current = Date.now();
    clear();
    timeoutRef.current = setTimeout(() => {
      onElapsedRef.current();
    }, Math.max(0, remainingRef.current));

    return clear;
  }, [resetKey, paused, durationMs]);
}

const SplashScreen: React.FC<Props> = ({ navigation }) => {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [activeIndex, setActiveIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const listRef = useRef<FlatList<Slide>>(null);

  // A freshly shown slide always starts playing from the top — never inherit a
  // stale hold state from the slide we just left.
  useEffect(() => {
    setPaused(false);
  }, [activeIndex]);

  // Auto-advance once the active slide has played its full loop. Driven off the
  // per-slide duration so timing matches each animation rather than a single
  // shared interval. Loops back to slide 1 after the last slide.
  const advance = useCallback(() => {
    const next = (activeIndex + 1) % SLIDES.length;
    listRef.current?.scrollToIndex({ index: next, animated: true });
    setActiveIndex(next);
  }, [activeIndex]);

  usePausableTimeout(SLIDES[activeIndex]?.durationMs ?? 0, advance, activeIndex, paused);

  const onMomentumScrollEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const offsetX = event?.nativeEvent?.contentOffset?.x ?? 0;
      const next = width > 0 ? Math.round(offsetX / width) : 0;
      // Manual swipe: realign the active slide (which resets its auto-advance
      // timer and restarts the landed-on slide's animation from the top).
      setActiveIndex(next);
    },
    [width],
  );

  // Any press-and-hold (pause OR right-strip 2x) freezes the auto-advance
  // countdown; releasing resumes it. AnimatedSlide owns the pause-vs-2x
  // decision (it needs the touch x-position) and drives the WebView directly.
  const handleHoldStart = useCallback(() => setPaused(true), []);
  const handleHoldEnd = useCallback(() => setPaused(false), []);

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
          loopMs={item.durationMs}
          isActive={index === activeIndex}
          onHoldStart={handleHoldStart}
          onHoldEnd={handleHoldEnd}
        />
      </View>
    ),
    [width, activeIndex, handleHoldStart, handleHoldEnd],
  );

  const bottomPad = Math.max(insets?.bottom ?? 0, 24);

  return (
    <View style={styles.container}>
      <FlatList
        ref={listRef}
        data={SLIDES}
        keyExtractor={(item) => item.key}
        renderItem={renderItem}
        extraData={activeIndex}
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