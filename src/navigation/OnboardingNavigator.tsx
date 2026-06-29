import React from 'react';
import { Alert, TouchableOpacity, Text } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { OnboardingStackParamList } from './types';
import ProfileSetupScreen from '../screens/onboarding/ProfileSetupScreen';
import AddDogScreen from '../screens/onboarding/AddDogScreen';
import LocationSetupScreen from '../screens/onboarding/LocationSetupScreen';
import PaywallScreen from '../screens/onboarding/PaywallScreen';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../contexts/ThemeContext';
import { OnboardingProvider } from '../contexts/OnboardingContext';

const Stack = createNativeStackNavigator<OnboardingStackParamList>();

const OnboardingStack: React.FC = () => {
  const { signOut } = useAuth();
  const { colors } = useTheme();

  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: true,
        headerTitle: '',
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.primary,
        headerBackButtonDisplayMode: 'minimal',
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen
        name="ProfileSetup"
        component={ProfileSetupScreen}
        options={{
          headerLeft: () => (
            <TouchableOpacity
              onPress={() => {
                Alert.alert(
                  'Are you sure you want to exit?',
                  "Your progress won't be saved.",
                  [
                    { text: 'Stay', style: 'cancel' },
                    { text: 'Exit', style: 'destructive', onPress: () => signOut() },
                  ]
                );
              }}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' }}
            >
              <Text style={{ fontSize: 22, color: '#FFFFFF', fontWeight: '600', marginLeft: -2, marginTop: -1 }}>{'‹'}</Text>
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

// Wrap entire navigator so all screens share the same onboarding state
const OnboardingNavigator: React.FC = () => (
  <OnboardingProvider>
    <OnboardingStack />
  </OnboardingProvider>
);

export default OnboardingNavigator;
