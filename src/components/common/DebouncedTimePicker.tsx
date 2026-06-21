import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Keyboard, Platform } from 'react-native';
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
 * to type a time via keyboard. We suppress this by dismissing the keyboard
 * whenever it tries to appear while this picker is mounted.
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

  // On mount, immediately commit the initial value.
  // The picker is conditionally rendered (mounts when user taps to open),
  // so this fires exactly when the picker appears and "locks in" whatever
  // time the spinner shows — no scroll required.
  const onTimeChangeRef = useRef(onTimeChange);
  onTimeChangeRef.current = onTimeChange;
  useEffect(() => {
    onTimeChangeRef.current(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Suppress keyboard input on the iOS spinner.
  // iOS 15+ opens a numeric keyboard when the user taps the selected row.
  // We don't want that — scroll-only interaction.
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    const sub = Keyboard.addListener('keyboardWillShow', () => {
      Keyboard.dismiss();
    });
    return () => sub.remove();
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
