import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { AuthStackParamList } from './types';
import SplashScreen from '../screens/auth/SplashScreen';
import SignInScreen from '../screens/auth/SignInScreen';
import SignUpScreen from '../screens/auth/SignUpScreen';
import LegacyAccountUpgradeScreen from '../screens/auth/LegacyAccountUpgradeScreen';
import PromoCodeEntryScreen from '../screens/auth/PromoCodeEntryScreen';
import AuthVideoBackground from '../components/auth/AuthVideoBackground';

const Stack = createNativeStackNavigator<AuthStackParamList>();

const AuthNavigator: React.FC = () => {
  return (
    <AuthVideoBackground>
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          animation: 'fade',
          contentStyle: { backgroundColor: 'transparent' },
        }}
      >
        <Stack.Screen name="Splash" component={SplashScreen} />
        <Stack.Screen name="SignIn" component={SignInScreen} />
        <Stack.Screen
          name="SignUpIntro"
          // Keep the 20MB animation JSON out of the initial auth bundle path.
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          getComponent={() => require('../screens/auth/SignUpIntroScreen').default}
        />
        <Stack.Screen name="SignUp" component={SignUpScreen} />
        <Stack.Screen name="LegacyAccountUpgrade" component={LegacyAccountUpgradeScreen} />
        <Stack.Screen name="PromoCode" component={PromoCodeEntryScreen} />
      </Stack.Navigator>
    </AuthVideoBackground>
  );
};

export default AuthNavigator;
