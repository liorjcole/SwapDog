import React, { useEffect, useState } from 'react';
import { Alert, TouchableOpacity, Text } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { OnboardingStackParamList } from './types';
import ProfileSetupScreen from '../screens/onboarding/ProfileSetupScreen';
import AddDogScreen from '../screens/onboarding/AddDogScreen';
import LocationSetupScreen from '../screens/onboarding/LocationSetupScreen';
import PaywallScreen from '../screens/onboarding/PaywallScreen';
import ConductStandardsScreen from '../screens/onboarding/ConductStandardsScreen';
import ContractScreen from '../screens/onboarding/ContractScreen';
import DeferredSignUpIntroScreen from '../screens/onboarding/DeferredSignUpIntroScreen';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../contexts/ThemeContext';
import { OnboardingProvider } from '../contexts/OnboardingContext';
import { useAuthContext } from '../contexts/AuthContext';
import LoadingSpinner from '../components/common/LoadingSpinner';
import { shouldShowDeferredSignUpIntro } from '../utils/signUpIntroFlow';

const Stack = createNativeStackNavigator<OnboardingStackParamList>();

const OnboardingStack: React.FC = () => {
  const { signOut } = useAuth();
  const { colors } = useTheme();
  const { userProfile } = useAuthContext();
  const [deferredIntroPending, setDeferredIntroPending] = useState<boolean | null>(null);

  useEffect(() => {
    let mounted = true;
    shouldShowDeferredSignUpIntro()
      .then((pending) => {
        if (mounted) setDeferredIntroPending(pending);
      })
      .catch(() => {
        if (mounted) setDeferredIntroPending(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  if (deferredIntroPending === null) {
    return <LoadingSpinner />;
  }

  const hasAccess =
    userProfile?.subscriptionStatus === 'active'
    || Boolean(userProfile?.freeAccessUntil && userProfile.freeAccessUntil > new Date());
  const initialRouteName: keyof OnboardingStackParamList =
    !userProfile?.profileSetupComplete
      ? 'ProfileSetup'
      : !hasAccess
        ? deferredIntroPending
          ? 'DeferredSignUpIntro'
          : 'Paywall'
        : !userProfile.conductAgreedAt
          ? 'ConductStandards'
          : 'Contract';

  return (
    <Stack.Navigator
      initialRouteName={initialRouteName}
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
      <Stack.Screen
        name="DeferredSignUpIntro"
        component={DeferredSignUpIntroScreen}
        options={{ headerShown: false, gestureEnabled: false }}
      />
      <Stack.Screen name="LocationSetup" component={LocationSetupScreen} />
      <Stack.Screen name="Paywall" component={PaywallScreen} />
      <Stack.Screen name="ConductStandards">
        {({ navigation }) => (
          <ConductStandardsScreen onAgreed={() => navigation.navigate('Contract')} />
        )}
      </Stack.Screen>
      <Stack.Screen name="Contract">
        {() => <ContractScreen />}
      </Stack.Screen>
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
