import { useRef, useCallback, useEffect, useState } from 'react';
import { ScrollView, Keyboard, Platform, Dimensions, View, NativeSyntheticEvent, NativeScrollEvent } from 'react-native';

/**
 * Hook that scrolls the bottom of an input group to sit exactly
 * at the top of the keyboard when the input is focused.
 *
 * Uses measureInWindow() at focus time to get the ACTUAL screen
 * position of each input group, regardless of View nesting depth.
 * This eliminates stale-layout and wrong-parent-offset bugs.
 */
export function useKeyboardScroll() {
  const scrollRef = useRef<ScrollView>(null);
  const viewRefs = useRef<Record<string, View | null>>({});
  const scrollY = useRef(0);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const keyboardHeightRef = useRef(0);

  useEffect(() => {
    const showSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      (e) => {
        keyboardHeightRef.current = e.endCoordinates.height;
        setKeyboardHeight(e.endCoordinates.height);
      },
    );
    const hideSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => {
        keyboardHeightRef.current = 0;
        setKeyboardHeight(0);
      },
    );
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  /** Attach to ScrollView's onScroll to track current offset. */
  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      scrollY.current = e.nativeEvent.contentOffset.y;
    },
    [],
  );

  /**
   * Returns a ref callback for a wrapper View. Use instead of onLayout:
   *   <View ref={refFor('dogName')}>
   */
  const refFor = useCallback(
    (key: string) =>
      (node: View | null) => {
        viewRefs.current[key] = node;
      },
    [],
  );

  /**
   * Legacy adapter — screens that still use onLayout can call this,
   * but the values are ignored. Kept so TypeScript doesn't break
   * while screens are migrated.
   */
  const registerInputGroup = useCallback(
    (_key: string, _y: number, _height: number) => {
      // no-op — replaced by refFor()
    },
    [],
  );

  /**
   * Call from the TextInput's onFocus to scroll the group into position.
   * Measures the View's actual window position at call time.
   */
  const scrollToInput = useCallback(
    (key: string) => {
      const view = viewRefs.current[key];
      if (!view) return;

      // Wait for keyboard to animate in
      setTimeout(() => {
        view.measureInWindow((_x: number, winY: number, _w: number, h: number) => {
          if (winY === undefined) return; // measurement failed
          const kbHeight = keyboardHeightRef.current || 336;
          const screenHeight = Dimensions.get('window').height;
          const visibleArea = screenHeight - kbHeight;

          // Bottom of input group + 12px breathing room
          const groupBottom = winY + h + 12;

          if (groupBottom > visibleArea) {
            const overshoot = groupBottom - visibleArea;
            scrollRef.current?.scrollTo({
              y: scrollY.current + overshoot,
              animated: true,
            });
          }
        });
      }, 350);
    },
    [],
  );

  return { scrollRef, onScroll, refFor, registerInputGroup, scrollToInput, keyboardHeight };
}
