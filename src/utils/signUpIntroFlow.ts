import AsyncStorage from '@react-native-async-storage/async-storage';

const DEFERRED_SIGN_UP_INTRO_KEY = '@watchdog_deferred_sign_up_intro';

export const deferSignUpIntro = async (): Promise<void> => {
  await AsyncStorage.setItem(DEFERRED_SIGN_UP_INTRO_KEY, 'pending');
};

export const clearDeferredSignUpIntro = async (): Promise<void> => {
  await AsyncStorage.removeItem(DEFERRED_SIGN_UP_INTRO_KEY);
};

export const shouldShowDeferredSignUpIntro = async (): Promise<boolean> => {
  const value = await AsyncStorage.getItem(DEFERRED_SIGN_UP_INTRO_KEY);
  return value === 'pending';
};
