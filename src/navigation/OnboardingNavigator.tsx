import React from 'react';
import { Alert, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { OnboardingStackParamList } from './types';
import ProfileSetupScreen from '../screens/onboarding/ProfileSetupScreen';
import AddDogScreen from '../screens/onboarding/AddDogScreen';
import LocationSetupScreen from '../screens/onboarding/LocationSetupScreen';
import PaywallScreen from '../screens/onboarding/PaywallScreen';
import { useAuth } from '../hooks/useAuth';

const Stack = createNativeStackNavigator<OnboardingStackParamList>();

const OnboardingNavigator: React.FC = () => {
  const { signOut } = useAuth();

  const handleExit = () => {
    Alert.alert(
      'Are you sure you want to exit?',
      "Your progress won't be saved.",
      [
        { text: 'Stay', style: 'cancel' },
        {
          text: 'Exit',
          style: 'destructive',
          onPress: () => signOut(),
        },
      ]
    );
  };

  const exitButton = () => (
    <TouchableOpacity onPress={handleExit} style={styles.exitBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
      <Text style={styles.exitText}>✕</Text>
    </TouchableOpacity>
  );

  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: true,
        headerTitle: '',
        headerBackVisible: true,
        headerShadowVisible: false,
        headerTransparent: true,
        headerLeft: exitButton,
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="ProfileSetup" component={ProfileSetupScreen} />
      <Stack.Screen name="AddDog" component={AddDogScreen} />
      <Stack.Screen name="LocationSetup" component={LocationSetupScreen} />
      <Stack.Screen name="Paywall" component={PaywallScreen} />
    </Stack.Navigator>
  );
};

const styles = StyleSheet.create({
  exitBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(150,150,150,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  exitText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#888',
  },
});

export default OnboardingNavigator;
