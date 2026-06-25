import React, { useCallback, useRef, useState } from 'react';
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
  // Loop duration (ms), drives the per-slide progress ring. Matches each
  // slide's internal loop: slide 1 restarts every 29.5s, slide 2 loops every
  // 10s, slide 3 every 14s.
  loopMs: number;
};

// The swipeable landing carousel. Adding slide 2 & 3 is a drop-in: place
// slideN.html in assets/signin-animations and append one entry here — no other
// changes are needed.
const SLIDES: Slide[] = [
  { key: 'slide1', source: require('../../../assets/signin-animations/slide1.html'), loopMs: 29500 },
  { key: 'slide2', source: require('../../../assets/signin-animations/slide2.html'), loopMs: 10000 },
  { key: 'slide3', source: require('../../../assets/signin-animations/slide3.html'), loopMs: 14000 },
];

const SplashScreen: React.FC<Props> = ({ navigation }) => {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<FlatList<Slide>>(null);

  const onMomentumScrollEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const offsetX = event?.nativeEvent?.contentOffset?.x ?? 0;
      const next = width > 0 ? Math.round(offsetX / width) : 0;
      setActiveIndex(next);
    },
    [width],
  );

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<Slide>) => (
      <View style={{ width }}>
        <AnimatedSlide source={item.source} loopMs={item.loopMs} />
      </View>
    ),
    [width],
  );

  const bottomPad = Math.max(insets?.bottom ?? 0, 24);

  return (
    <View style={styles.container}>
      <FlatList
        ref={listRef}
        data={SLIDES}
        keyExtractor={(item) => item.key}
        renderItem={renderItem}
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