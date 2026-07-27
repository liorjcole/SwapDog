import React, { useCallback, useRef } from 'react';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { SignUpIntroExperience } from '../auth/SignUpIntroScreen';
import { OnboardingStackParamList } from '../../navigation/types';
import { clearDeferredSignUpIntro } from '../../utils/signUpIntroFlow';

type Props = {
  navigation: NativeStackNavigationProp<OnboardingStackParamList, 'DeferredSignUpIntro'>;
};

const DeferredSignUpIntroScreen: React.FC<Props> = ({ navigation }) => {
  const completing = useRef(false);

  const handleComplete = useCallback(() => {
    if (completing.current) return;
    completing.current = true;

    clearDeferredSignUpIntro()
      .catch(() => undefined)
      .finally(() => {
        navigation.replace('Paywall');
      });
  }, [navigation]);

  return (
    <SignUpIntroExperience
      onBack={() => {
        if (navigation.canGoBack()) {
          navigation.goBack();
        }
      }}
      onComplete={handleComplete}
    />
  );
};

export default DeferredSignUpIntroScreen;
