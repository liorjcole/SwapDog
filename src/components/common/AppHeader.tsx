import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { NativeStackHeaderProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../contexts/ThemeContext';

/**
 * Shared header for all native-stack screens.
 * Adds generous top padding above the back button so it's never cramped
 * under the status bar notch.
 */
const AppHeader: React.FC<NativeStackHeaderProps> = ({ navigation, route, options, back }) => {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  // Minimum top padding: safe area + extra breathing room
  const topPadding = insets.top + (Platform.OS === 'ios' ? 8 : 12);
  const title = options.title ?? route.name;

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: options.headerStyle
            ? (options.headerStyle as { backgroundColor?: string }).backgroundColor ?? colors.surface
            : colors.surface,
          paddingTop: topPadding,
        },
      ]}
    >
      <View style={styles.row}>
        {back ? (
          <TouchableOpacity
            onPress={navigation.goBack}
            style={styles.backButton}
            accessibilityLabel="Go back"
            accessibilityRole="button"
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={[styles.backIcon, { color: colors.primary }]}>‹</Text>
            {options.headerBackTitle ? (
              <Text style={[styles.backLabel, { color: colors.primary }]}>{options.headerBackTitle}</Text>
            ) : null}
          </TouchableOpacity>
        ) : (
          <View style={styles.backButton} />
        )}
        <Text
          style={[styles.title, { color: colors.text }]}
          numberOfLines={1}
          accessibilityRole="header"
        >
          {title}
        </Text>
        {/* Right spacer to keep title centered */}
        <View style={styles.rightSpacer} />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingBottom: 12,
    borderBottomWidth: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    minHeight: 44,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 70,
    paddingLeft: 4,
  },
  backIcon: {
    fontSize: 32,
    lineHeight: 36,
    fontWeight: '400',
  },
  backLabel: {
    fontSize: 18,
    fontWeight: '400',
    marginLeft: 2,
  },
  title: {
    flex: 1,
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  rightSpacer: {
    minWidth: 70,
  },
});

export default AppHeader;
