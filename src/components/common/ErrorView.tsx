import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';
import { spacing, borderRadius, typography } from '../../config/theme';

interface Props {
  message?: string;
  onRetry?: () => void;
}

const ErrorView: React.FC<Props> = ({ message = 'Something went wrong', onRetry }) => {
  const { colors } = useTheme();
  return (
    <View style={styles.container}>
      <Text style={styles.emoji} accessibilityElementsHidden>⚠️</Text>
      <Text style={[styles.message, { color: colors.text }]}>{message}</Text>
      {onRetry && (
        <TouchableOpacity
          style={[styles.btn, { backgroundColor: colors.primary }]}
          onPress={onRetry}
          accessibilityLabel="Try again"
          accessibilityRole="button"
        >
          <Text style={styles.btnText}>Try Again</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  emoji: { fontSize: 50, marginBottom: spacing.md },
  message: { ...typography.body, textAlign: 'center', marginBottom: spacing.lg },
  btn: { paddingHorizontal: spacing.xl, paddingVertical: spacing.sm, borderRadius: borderRadius.full },
  btnText: { color: '#fff', fontWeight: '600' },
});

export default ErrorView;
