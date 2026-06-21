import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AuthStackParamList } from '../../navigation/types';
import { useTheme } from '../../contexts/ThemeContext';
import { spacing } from '../../config/theme';

type Props = {
  navigation: NativeStackNavigationProp<AuthStackParamList, 'Splash'>;
};

const SplashScreen: React.FC<Props> = ({ navigation }) => {
  const { colors } = useTheme();
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.8)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, friction: 6, useNativeDriver: true }),
    ]).start();
    const timer = setTimeout(() => navigation.replace('SignIn'), 2000);
    return () => clearTimeout(timer);
  }, [navigation, opacity, scale]);

  return (
    <View style={[styles.container, { backgroundColor: colors.primary }]} accessibilityRole="none">
      <Animated.View style={{ opacity, transform: [{ scale }] }}>
        <Text style={styles.emoji} accessibilityElementsHidden>🐾</Text>
        <Text style={styles.title} accessibilityLabel="WatchDog">WatchDog</Text>
        <Text style={styles.subtitle}>Peer-to-peer dog sitting exchange</Text>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emoji: { fontSize: 66, textAlign: 'center', marginBottom: spacing.sm },
  title: { fontSize: 42, fontWeight: '800', color: '#fff', textAlign: 'center' },
  subtitle: { fontSize: 18, color: 'rgba(255,255,255,0.85)', textAlign: 'center', marginTop: spacing.sm },
});

export default SplashScreen;
