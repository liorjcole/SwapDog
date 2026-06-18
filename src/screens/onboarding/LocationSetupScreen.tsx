import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Location from 'expo-location';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import * as Haptics from 'expo-haptics';
import { OnboardingStackParamList } from '../../navigation/types';
import { useAuthContext } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { db } from '../../config/firebase';
import { registerForPushNotifications, savePushToken } from '../../services/NotificationService';
import { spacing, borderRadius, typography } from '../../config/theme';
import { useOnboarding } from '../../contexts/OnboardingContext';

type Props = {
  navigation: NativeStackNavigationProp<OnboardingStackParamList, 'LocationSetup'>;
};

const LocationSetupScreen: React.FC<Props> = () => {
  const { colors } = useTheme();
  const { user, refreshUserProfile } = useAuthContext();
  const { locationName, setLocationName } = useOnboarding();
  const [loading, setLoading] = useState(false);

  const handleGetLocation = async () => {
    setLoading(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Denied', 'Location permission is needed to find nearby dog owners');
        setLoading(false);
        return;
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const [place] = await Location.reverseGeocodeAsync({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
      const name = place ? `${place.city ?? ''}, ${place.region ?? ''}`.trim() : 'Your location';
      setLocationName(name);

      if (!user) return;
      await updateDoc(doc(db, 'users', user.uid), {
        location: { latitude: loc.coords.latitude, longitude: loc.coords.longitude },
        locationName: name,
        isOnboarded: true,
        updatedAt: serverTimestamp(),
      });

      // Register push notifications after onboarding
      const token = await registerForPushNotifications();
      if (token) {
        await savePushToken(user.uid, token);
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await refreshUserProfile();
      navigation.navigate('Paywall');
    } catch (error: unknown) {
      Alert.alert('Error', error instanceof Error ? error.message : 'Failed to get location');
    } finally {
      setLoading(false);
    }
  };

  const handleSkip = async () => {
    if (!user) return;
    setLoading(true);
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        updatedAt: serverTimestamp(),
      });
      navigation.navigate('Paywall');
    } catch (error: unknown) {
      Alert.alert('Error', error instanceof Error ? error.message : 'Failed to complete setup');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Text style={styles.emoji} accessibilityElementsHidden>📍</Text>
      <Text style={[styles.title, { color: colors.text }]}>Set your location</Text>
      <Text style={[styles.sub, { color: colors.textSecondary }]}>
        Find dog owners near you. We only store your approximate location.
      </Text>
      {locationName && (
        <Text style={[styles.locationName, { color: colors.success }]} accessibilityLabel={`Location set to ${locationName}`}>
          ✓ {locationName}
        </Text>
      )}
      {loading ? (
        <ActivityIndicator size="large" color={colors.primary} accessibilityLabel="Getting location" />
      ) : (
        <>
          <TouchableOpacity
            style={[styles.btn, { backgroundColor: colors.primary }]}
            onPress={handleGetLocation}
            accessibilityLabel="Use my current location"
            accessibilityRole="button"
            accessibilityHint="Grants location access to find nearby dog owners"
          >
            <Text style={styles.btnText}>Use My Current Location</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleSkip}
            accessibilityLabel="Skip location setup"
            accessibilityRole="button"
          >
            <Text style={[styles.skip, { color: colors.textSecondary }]}>Skip for now</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, padding: spacing.lg, paddingTop: spacing.lg, justifyContent: 'center', alignItems: 'center' },
  emoji: { fontSize: 64, marginBottom: spacing.lg },
  title: { ...typography.h2, textAlign: 'center', marginBottom: spacing.sm },
  sub: { ...typography.body, textAlign: 'center', marginBottom: spacing.xl },
  locationName: { fontSize: 16, fontWeight: '600', marginBottom: spacing.lg },
  btn: { padding: spacing.md, borderRadius: borderRadius.md, alignItems: 'center', width: '100%', marginBottom: spacing.md },
  btnText: { color: '#fff', ...typography.button },
  skip: { fontSize: 15, marginTop: spacing.sm },
});

export default LocationSetupScreen;
