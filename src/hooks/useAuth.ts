import {
  signInWithEmailAndPassword,
  signInWithCustomToken,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { app, auth } from '../config/firebase';
import { normalizePhoneNumber } from '../utils/phoneAuth';
const REFERRAL_STORAGE_KEY = '@swapdog_referral_code';

type PhoneAuthMode = 'signIn' | 'signUp';

type StartPhoneVerificationResponse = {
  phoneNumber: string;
};

type VerifyPhoneCodeResponse = {
  status?: 'authenticated' | 'verifiedNoAccount';
  token?: string;
  isNewUser?: boolean;
  phoneNumber?: string;
  signupTicket?: string;
};

type VerifyPhoneCodeResult =
  | {
      status: 'authenticated';
      isNewUser: boolean;
    }
  | {
      status: 'verifiedNoAccount';
      phoneNumber: string;
      signupTicket: string;
    };

type CompletePhoneSignUpResponse = {
  token: string;
  isNewUser: boolean;
};

type PhoneUpgradeTicketResponse = {
  phoneNumber: string;
  signupTicket: string;
};

type CompletePhoneUpgradeResponse = {
  token: string;
};

export const useAuth = () => {
  const firebaseFunctions = getFunctions(app);

  const sendPhoneCode = async (phoneNumber: string): Promise<string> => {
    const normalizedPhoneNumber = normalizePhoneNumber(phoneNumber);
    const startPhoneVerification = httpsCallable<
      { phoneNumber: string },
      StartPhoneVerificationResponse
    >(firebaseFunctions, 'startPhoneVerification');
    const result = await startPhoneVerification({ phoneNumber: normalizedPhoneNumber });
    return result.data.phoneNumber;
  };

  const verifyPhoneCode = async (
    phoneNumber: string,
    code: string,
    mode: PhoneAuthMode,
  ): Promise<VerifyPhoneCodeResult> => {
    const normalizedPhoneNumber = normalizePhoneNumber(phoneNumber);
    const referralCode = await AsyncStorage.getItem(REFERRAL_STORAGE_KEY);
    const verifyCode = httpsCallable<
      {
        phoneNumber: string;
        code: string;
        mode: PhoneAuthMode;
        referralCode?: string;
        supportsSignupTicket: boolean;
      },
      VerifyPhoneCodeResponse
    >(firebaseFunctions, 'verifyPhoneCode');
    const result = await verifyCode({
      phoneNumber: normalizedPhoneNumber,
      code: code.trim(),
      mode,
      supportsSignupTicket: true,
      ...(referralCode ? { referralCode } : {}),
    });

    if (result.data.status === 'verifiedNoAccount') {
      if (!result.data.phoneNumber || !result.data.signupTicket) {
        throw new Error('Missing verified phone signup details.');
      }
      return {
        status: 'verifiedNoAccount',
        phoneNumber: result.data.phoneNumber,
        signupTicket: result.data.signupTicket,
      };
    }

    if (!result.data.token) {
      throw new Error('Missing sign-in token.');
    }

    await signInWithCustomToken(auth, result.data.token);
    return {
      status: 'authenticated',
      isNewUser: result.data.isNewUser ?? false,
    };
  };

  const completePhoneSignUp = async (
    phoneNumber: string,
    signupTicket: string,
  ): Promise<void> => {
    const normalizedPhoneNumber = normalizePhoneNumber(phoneNumber);
    const referralCode = await AsyncStorage.getItem(REFERRAL_STORAGE_KEY);
    const completeSignUp = httpsCallable<
      { phoneNumber: string; signupTicket: string; referralCode?: string },
      CompletePhoneSignUpResponse
    >(firebaseFunctions, 'completePhoneSignUp');
    const result = await completeSignUp({
      phoneNumber: normalizedPhoneNumber,
      signupTicket,
      ...(referralCode ? { referralCode } : {}),
    });
    await signInWithCustomToken(auth, result.data.token);
  };

  const verifyPhoneForAccountUpgrade = async (
    phoneNumber: string,
    code: string,
  ): Promise<PhoneUpgradeTicketResponse> => {
    const normalizedPhoneNumber = normalizePhoneNumber(phoneNumber);
    const verifyPhone = httpsCallable<
      { phoneNumber: string; code: string },
      PhoneUpgradeTicketResponse
    >(firebaseFunctions, 'verifyPhoneForAccountUpgrade');
    const result = await verifyPhone({
      phoneNumber: normalizedPhoneNumber,
      code: code.trim(),
    });

    if (!result.data.phoneNumber || !result.data.signupTicket) {
      throw new Error('Missing verified phone upgrade details.');
    }
    return result.data;
  };

  const attachPhoneToCurrentUser = async (
    phoneNumber: string,
    signupTicket: string,
  ): Promise<void> => {
    const normalizedPhoneNumber = normalizePhoneNumber(phoneNumber);
    const attachPhone = httpsCallable<
      { phoneNumber: string; signupTicket: string },
      CompletePhoneUpgradeResponse
    >(firebaseFunctions, 'attachPhoneToCurrentUser');
    const result = await attachPhone({
      phoneNumber: normalizedPhoneNumber,
      signupTicket,
    });

    if (!result.data.token) {
      throw new Error('Missing upgraded sign-in token.');
    }
    await signInWithCustomToken(auth, result.data.token);
  };

  const attachVerifiedPhoneToEmailAccount = async (
    email: string,
    password: string,
    phoneNumber: string,
    signupTicket: string,
  ): Promise<void> => {
    const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
    await credential.user.getIdToken(true);
    await attachPhoneToCurrentUser(phoneNumber, signupTicket);
  };

  const upgradeEmailAccountToPhone = async (
    email: string,
    password: string,
    phoneNumber: string,
    code: string,
  ): Promise<void> => {
    const verified = await verifyPhoneForAccountUpgrade(phoneNumber, code);
    await attachVerifiedPhoneToEmailAccount(
      email,
      password,
      verified.phoneNumber,
      verified.signupTicket,
    );
  };

  const signOut = async (): Promise<void> => {
    await firebaseSignOut(auth);
  };

  return {
    sendPhoneCode,
    verifyPhoneCode,
    completePhoneSignUp,
    verifyPhoneForAccountUpgrade,
    attachPhoneToCurrentUser,
    attachVerifiedPhoneToEmailAccount,
    upgradeEmailAccountToPhone,
    signOut,
  };
};
