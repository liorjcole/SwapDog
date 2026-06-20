import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';

interface Props {
  /** Current character count (pre-trimmed by caller) */
  current: number;
  /** Minimum required characters (shows progress toward this) */
  min?: number;
  /** Maximum allowed characters (shown as "/max" when valid) */
  max?: number;
  /** Override the label shown when valid. Default: "{current} characters ✓" */
  validLabel?: string;
}

/**
 * Consistent character-count hint shown below text inputs.
 *
 * - Below min  → "12/20 characters minimum"  (secondary color)
 * - At/above min → "45 characters ✓"          (success green)
 * - With max   → "45/500 characters ✓"        (success green)
 *
 * Usage:
 *   <CharCountHint current={bio.trim().length} min={20} max={500} />
 */
const CharCountHint: React.FC<Props> = ({ current, min, max, validLabel }) => {
  const { colors } = useTheme();

  const meetsMin = min == null || current >= min;
  const color = meetsMin ? colors.success : colors.textSecondary;

  let label: string;
  if (validLabel && meetsMin) {
    label = validLabel;
  } else if (!meetsMin && min != null) {
    label = `${current}/${min} characters minimum`;
  } else if (max != null) {
    label = `${current}/${max} characters ✓`;
  } else {
    label = `${current} characters ✓`;
  }

  return <Text style={[styles.hint, { color }]}>{label}</Text>;
};

const styles = StyleSheet.create({
  hint: {
    fontSize: 12,
    marginTop: 4,
    paddingHorizontal: 4,
  },
});

export default CharCountHint;
