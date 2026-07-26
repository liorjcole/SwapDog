import { NavigatorScreenParams } from '@react-navigation/native';
import { ReviewFlowParams } from '../hooks/useReviewFlow';

export type AuthStackParamList = {
  Splash: undefined;
  SignIn: undefined;
  SignUpIntro: undefined;
  SignUp: { phoneNumber?: string };
  LegacyAccountUpgrade: undefined;
  PromoCode: undefined;
};

export type OnboardingStackParamList = {
  ProfileSetup: undefined;
  AddDog: undefined;
  Paywall: undefined;
  LocationSetup: undefined;
};

export type ApprovalStackParamList = {
  Celebration: undefined;
  Contract: undefined;
};

export type DiscoverStackParamList = {
  Discover: { highlightPostId?: string } | undefined;
  UserDetail: { userId: string };
  DogDetail: { dogId: string };
  CreateSwap: { userId: string };
  /** New: navigate directly to create a public post */
  CreatePost: undefined;
  /** Full detail view for a public area post (from Discover feed) */
  PostDetail: { postId: string };
  /** Chat screen within Discover stack (for back navigation) */
  Chat: { conversationId: string; otherUserId: string };
  /** Layered anonymized reviews breakdown (user mode + dog mode) */
  ReviewsList: { userId: string; displayName: string; dogId?: string; dogName?: string };
};

export type RequestsStackParamList = {
  Requests: undefined;
  WriteReview: { swapRequestId: string; revieweeId: string; reviewRole?: 'owner' | 'sitter'; lateCancellation?: boolean };
  /** Voluntary review — opens as modal within Requests stack so goBack() returns to Schedule */
  Review: ReviewFlowParams;
  UserDetail: { userId: string };
  DogDetail: { dogId: string };
  /** Full detail view for a public area post */
  PostDetail: { postId: string };
  /** Create a new public post */
  CreatePost: undefined;
  /** Chat screen within Requests stack (for back navigation) */
  Chat: { conversationId: string; otherUserId: string };
  /** Layered anonymized reviews breakdown (user mode + dog mode) */
  ReviewsList: { userId: string; displayName: string; dogId?: string; dogName?: string };
};

export type MessagesStackParamList = {
  ConversationsList: undefined;
  Chat: { conversationId: string; otherUserId: string };
  UserDetail: { userId: string };
  DogDetail: { dogId: string };
  /** Layered anonymized reviews breakdown (UserDetail is reachable from Messages too) */
  ReviewsList: { userId: string; displayName: string; dogId?: string; dogName?: string };
};

export type ProfileStackParamList = {
  Referral: undefined;
  Profile: undefined;
  UserDetail: { userId: string };
  DogDetail: { dogId: string };
  Review: {
    postId: string;
    role: 'owner' | 'caregiver';
    otherUserId: string;
    otherUserName: string;
    dogIds: string[];
    dogNames: string[];
  };
  EditProfile: undefined;
  /** dogId is optional: omit (or pass undefined) to create a new dog */
  EditDog: { dogId?: string; hidePhotos?: boolean };
  CommunityStandards: undefined;
  MyAgreement: undefined;
  PointsHistory: undefined;
  /** Chat screen within Profile stack (for back navigation) */
  Chat: { conversationId: string; otherUserId: string };
  /** Layered anonymized reviews breakdown (user mode + dog mode) */
  ReviewsList: { userId: string; displayName: string; dogId?: string; dogName?: string };
};

export type MainTabParamList = {
  DiscoverTab: NavigatorScreenParams<DiscoverStackParamList>;
  RequestsTab: NavigatorScreenParams<RequestsStackParamList>;
  MessagesTab: NavigatorScreenParams<MessagesStackParamList>;
  ProfileTab: NavigatorScreenParams<ProfileStackParamList>;
};

export type RootStackParamList = {
  Referral: undefined;
  Auth: NavigatorScreenParams<AuthStackParamList>;
  LegacyAccountUpgrade: undefined;
  Onboarding: NavigatorScreenParams<OnboardingStackParamList>;
  ConductStandards: undefined;
  WaitingApproval: undefined;
  ApprovalFlow: NavigatorScreenParams<ApprovalStackParamList>;
  Main: NavigatorScreenParams<MainTabParamList>;
};
