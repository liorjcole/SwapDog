import React, { useState, useEffect, useRef, useCallback } from 'react';
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
