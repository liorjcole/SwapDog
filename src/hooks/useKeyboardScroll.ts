import { useRef, useCallback, useEffect, useState } from 'react';
import {
  ScrollView,
  Keyboard,
  Platform,
  Dimensions,
  View,
  NativeSyntheticEvent,
  NativeScrollEvent,
  LayoutChangeEvent,
} from 'react-native';

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
  const contentHeight = useRef(0);
  const viewportHeight = useRef(0);
  const focusedKeyRef = useRef<string | null>(null);
  const focusedExtraClearanceRef = useRef(0);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const keyboardHeightRef = useRef(0);

  const maxScrollY = useCallback((): number => (
    Math.max(0, contentHeight.current - viewportHeight.current)
  ), []);

  const clampScrollY = useCallback((y: number): number => (
    Math.max(0, Math.min(y, maxScrollY()))
  ), [maxScrollY]);

  const alignInputToKeyboard = useCallback(
    (key: string, extraClearance = focusedExtraClearanceRef.current) => {
      const view = viewRefs.current[key];
      if (!view) return;

      view.measureInWindow((_x: number, winY: number, _w: number, h: number) => {
        if (winY === undefined) return;
        const kbHeight = keyboardHeightRef.current || 336;
        const screenHeight = Dimensions.get('window').height;
        const visibleArea = screenHeight - kbHeight;
        const groupBottom = winY + h + 12 + extraClearance;
        const targetY = clampScrollY(scrollY.current + groupBottom - visibleArea);

        if (Math.abs(targetY - scrollY.current) > 1) {
          scrollRef.current?.scrollTo({ y: targetY, animated: true });
        }
      });
    },
    [clampScrollY],
  );

  useEffect(() => {
    const showSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      (e) => {
        keyboardHeightRef.current = e.endCoordinates.height;
        setKeyboardHeight(e.endCoordinates.height);
        const focusedKey = focusedKeyRef.current;
        if (focusedKey) {
          const extraClearance = focusedExtraClearanceRef.current;
          requestAnimationFrame(() => alignInputToKeyboard(focusedKey, extraClearance));
          setTimeout(() => alignInputToKeyboard(focusedKey, extraClearance), 120);
          setTimeout(() => alignInputToKeyboard(focusedKey, extraClearance), 320);
        }
      },
    );
    const hideSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => {
        focusedKeyRef.current = null;
        focusedExtraClearanceRef.current = 0;
        keyboardHeightRef.current = 0;
        setKeyboardHeight(0);
        setTimeout(() => {
          const clamped = clampScrollY(scrollY.current);
          if (Math.abs(clamped - scrollY.current) > 1) {
            scrollRef.current?.scrollTo({ y: clamped, animated: true });
          }
        }, Platform.OS === 'ios' ? 250 : 0);
      },
    );
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [alignInputToKeyboard, clampScrollY]);

  /** Attach to ScrollView's onScroll to track current offset. */
  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      scrollY.current = e.nativeEvent.contentOffset.y;
    },
    [],
  );

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    viewportHeight.current = e.nativeEvent.layout.height;
  }, []);

  const onContentSizeChange = useCallback((_width: number, height: number) => {
    contentHeight.current = height;
  }, []);

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
    (key: string, extraClearance = 0) => {
      focusedKeyRef.current = key;
      focusedExtraClearanceRef.current = extraClearance;

      // Run once immediately if the keyboard is already visible, then retry
      // through the animation window for first-focus cases.
      requestAnimationFrame(() => alignInputToKeyboard(key, extraClearance));
      setTimeout(() => alignInputToKeyboard(key, extraClearance), 180);
      setTimeout(() => alignInputToKeyboard(key, extraClearance), 420);
    },
    [alignInputToKeyboard],
  );

  return {
    scrollRef,
    onScroll,
    onLayout,
    onContentSizeChange,
    refFor,
    registerInputGroup,
    scrollToInput,
    keyboardHeight,
  };
}
