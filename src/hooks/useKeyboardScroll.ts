import { useRef, useCallback, useEffect, useState } from 'react';
import { ScrollView, Keyboard, Platform, Dimensions } from 'react-native';

/**
 * Hook that scrolls the bottom of an input group to sit exactly
 * at the top of the keyboard when the input is focused.
 *
 * Each input group (input + any subtext below) is wrapped in a View
 * with onLayout recording both Y and height. On focus, we calculate:
 *   scrollY = (groupY + groupHeight) - (screenHeight - keyboardHeight)
 *
 * This places the bottom edge of the group flush with the keyboard top.
 */
export function useKeyboardScroll() {
  const scrollRef = useRef<ScrollView>(null);
  const inputLayout = useRef<Record<string, { y: number; height: number }>>({}).current;
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

  /**
   * Call from the wrapping View's onLayout to register an input group.
   */
  const registerInputGroup = useCallback(
    (key: string, y: number, height: number) => {
      inputLayout[key] = { y, height };
    },
    [inputLayout],
  );

  /**
   * Call from the TextInput's onFocus to scroll the group into position.
   * Adds a small 12px breathing room below the group.
   */
  const scrollToInput = useCallback(
    (key: string) => {
      const layout = inputLayout[key];
      if (!layout) return;

      // Wait for keyboard to animate in
      setTimeout(() => {
        const kbHeight = keyboardHeightRef.current || 336; // fallback ~iPhone keyboard
        const screenHeight = Dimensions.get('window').height;
        const visibleArea = screenHeight - kbHeight;

        // We want the bottom of the group at the top of the keyboard (with 12px gap)
        const groupBottom = layout.y + layout.height + 12;
        const scrollY = groupBottom - visibleArea;

        scrollRef.current?.scrollTo({
          y: Math.max(0, scrollY),
          animated: true,
        });
      }, 350);
    },
    [inputLayout],
  );

  return { scrollRef, registerInputGroup, scrollToInput, keyboardHeight };
}
