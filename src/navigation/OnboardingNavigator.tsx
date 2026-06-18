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

  const handleExitFromFirst = () => {
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

  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: true,
        headerTitle: '',
        headerBackVisible: true,
        headerShadowVisible: false,
        headerTransparent: true,
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen
        name="ProfileSetup"
        component={ProfileSetupScreen}
        options={{
          headerLeft: () => (
            <TouchableOpacity
              onPress={handleExitFromFirst}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={styles.backBtn}
            >
              <Text style={styles.backArrow}>‹</Text>
            </TouchableOpacity>
          ),
        }}
      />
      <Stack.Screen name="AddDog" component={AddDogScreen} />
      <Stack.Screen name="LocationSetup" component={LocationSetupScreen} />
      <Stack.Screen name="Paywall" component={PaywallScreen} />
    </Stack.Navigator>
  );
};

const styles = StyleSheet.create({
  backBtn: {
    paddingRight: 8,
  },
  backArrow: {
    fontSize: 34,
    fontWeight: '300',
    color: '#007AFF',
    marginTop: -2,
  },
});

export default OnboardingNavigator;
