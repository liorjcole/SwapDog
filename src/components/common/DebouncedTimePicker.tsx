import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Keyboard, Platform, View } from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';

interface Props {
  value: Date;
  onTimeChange: (d: Date) => void;
  maximumDate?: Date;
  minimumDate?: Date;
}

/**
 * iOS spinner DateTimePicker wrapper that prevents snap-back and
 * completely suppresses keyboard input.
 *
 * Snap-back fix: Local state + debounced parent callback.
 * Keyboard fix: On iOS 15+, tapping the highlighted spinner row opens
 * a numeric keyboard. We suppress it with:
 *   - onTouchStart on wrapper: schedules staggered Keyboard.dismiss()
 *     calls AFTER the native UIDatePicker activates the keyboard
 *   - keyboardWillShow + keyboardDidShow listeners as backup
 * The keyboard may flash for ~50ms but is immediately dismissed.
 * Scroll gestures are not affected.
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
  const dismissTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const onTimeChangeRef = useRef(onTimeChange);
  onTimeChangeRef.current = onTimeChange;

  useEffect(() => {
    onTimeChangeRef.current(value);
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      dismissTimers.current.forEach(t => clearTimeout(t));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keyboard suppression listeners
  useEffect(() => {
    if (Platform.OS !== 'ios') return;

    const dismiss = () => {
      if (mountedRef.current) Keyboard.dismiss();
    };

    const sub1 = Keyboard.addListener('keyboardWillShow', dismiss);
    const sub2 = Keyboard.addListener('keyboardDidShow', dismiss);

    return () => {
      sub1.remove();
      sub2.remove();
    };
  }, []);

  // Schedule staggered dismissals after any touch on the picker
  const handleTouchStart = useCallback(() => {
    if (Platform.OS !== 'ios') return;
    // Clear any pending dismiss timers
    dismissTimers.current.forEach(t => clearTimeout(t));
    dismissTimers.current = [];
    // Schedule dismissals after the native tap handler activates keyboard
    [50, 100, 200, 350, 500].forEach(ms => {
      const t = setTimeout(() => {
        if (mountedRef.current) Keyboard.dismiss();
      }, ms);
      dismissTimers.current.push(t);
    });
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
    setLocalValue(d);

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      isScrollingRef.current = false;
      onTimeChange(d);
    }, 500);
  }, [onTimeChange]);

  return (
    <View onTouchStart={handleTouchStart}>
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
    </View>
  );
});

export default DebouncedTimePicker;
