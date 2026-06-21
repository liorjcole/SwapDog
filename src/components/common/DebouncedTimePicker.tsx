import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Keyboard, Platform, InputAccessoryView, TextInput, findNodeHandle, UIManager } from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';

interface Props {
  value: Date;
  onTimeChange: (d: Date) => void;
  maximumDate?: Date;
  minimumDate?: Date;
}

/**
 * iOS spinner DateTimePicker wrapper that prevents snap-back.
 *
 * Problem: The spinner fires onChange on EVERY scroll tick. If the parent
 * state update triggers a re-render before the next tick, the controlled
 * `value` prop resets the spinner to the old position — "snap-back".
 *
 * Solution: This component keeps its OWN local state that updates
 * immediately (so the spinner never snaps back) and debounces the
 * callback to the parent (so the parent doesn't re-render on every tick).
 * React.memo prevents parent re-renders from resetting the local state.
 *
 * On mount, the picker immediately commits its initial value so the user
 * doesn't have to scroll if the shown time is already what they want.
 *
 * Keyboard suppression: iOS 15+ lets users tap the selected spinner row
 * to type a time via keyboard. We aggressively suppress this using both
 * keyboardWillShow and keyboardDidShow listeners, plus a periodic check.
 */
const DebouncedTimePicker: React.FC<Props> = React.memo(({
  value,
  onTimeChange,
  maximumDate,
  minimumDate,
}) => {
  const [localValue, setLocalValue] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isScrollingRef = useRef(false);
  const mountedRef = useRef(true);

  // On mount, immediately commit the initial value.
  const onTimeChangeRef = useRef(onTimeChange);
  onTimeChangeRef.current = onTimeChange;
  useEffect(() => {
    onTimeChangeRef.current(value);
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Aggressively suppress keyboard input on the iOS spinner.
  // iOS 15+ opens a numeric keyboard when the user taps the selected row.
  // We use multiple layers of suppression to ensure scroll-only interaction.
  useEffect(() => {
    if (Platform.OS !== 'ios') return;

    const dismiss = () => {
      if (mountedRef.current) Keyboard.dismiss();
    };

    // Layer 1: Catch keyboard before it appears
    const sub1 = Keyboard.addListener('keyboardWillShow', dismiss);
    // Layer 2: If it slips through, dismiss immediately after it appears
    const sub2 = Keyboard.addListener('keyboardDidShow', dismiss);
    // Layer 3: Periodic check as a safety net (every 300ms)
    const interval = setInterval(dismiss, 300);

    return () => {
      sub1.remove();
      sub2.remove();
      clearInterval(interval);
    };
  }, []);

  // Sync from parent ONLY when not actively scrolling
  useEffect(() => {
    if (!isScrollingRef.current) {
      setLocalValue(value);
    }
  }, [value]);

  const handleChange = useCallback((_: DateTimePickerEvent, d?: Date) => {
    if (!d) return;
    isScrollingRef.current = true;
    setLocalValue(d); // immediate — picker won't snap back

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      isScrollingRef.current = false;
      onTimeChange(d);
    }, 500);
  }, [onTimeChange]);

  return (
    <DateTimePicker
      value={localValue}
      mode="time"
      display="spinner"
      themeVariant="dark"
      accentColor="#FF2D55"
      {...(maximumDate ? { maximumDate } : {})}
      {...(minimumDate ? { minimumDate } : {})}
      onChange={handleChange}
      style={{ height: 200 }}
    />
  );
});

export default DebouncedTimePicker;
