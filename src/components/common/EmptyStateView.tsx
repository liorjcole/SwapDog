import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';
import { spacing, typography } from '../../config/theme';

interface Props {
  emoji?: string;
  title: string;
  subtitle?: string;
}

const EmptyStateView: React.FC<Props> = ({ emoji = '🔍', title, subtitle }) => {
  const { colors } = useTheme();
  return (
    <View style={styles.container} accessibilityRole="none">
      <Text style={styles.emoji} accessibilityElementsHidden>{emoji}</Text>
      <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">{title}</Text>
      {subtitle && <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{subtitle}</Text>}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl * 2 },
  emoji: { fontSize: 50, marginBottom: spacing.md },
  title: { ...typography.h3, textAlign: 'center', marginBottom: spacing.sm },
  subtitle: { ...typography.body, textAlign: 'center' },
});

export default EmptyStateView;
