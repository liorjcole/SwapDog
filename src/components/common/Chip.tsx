import React from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';
import { borderRadius, spacing } from '../../config/theme';

interface Props {
  label: string;
  selected?: boolean;
  onPress?: () => void;
}

const Chip: React.FC<Props> = ({ label, selected = false, onPress }) => {
  const { colors } = useTheme();
  return (
    <TouchableOpacity
      style={[
        styles.chip,
        { backgroundColor: selected ? colors.primary : colors.surface, borderColor: colors.border },
      ]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
    >
      <Text style={[styles.label, { color: selected ? '#fff' : colors.text }]}>{label}</Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    marginRight: spacing.xs,
    marginBottom: spacing.xs,
  },
  label: { fontSize: 15, fontWeight: '500' },
});

export default Chip;
