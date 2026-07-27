import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../config/firebase';
import {
  Dog,
  ReviewTargetType,
  SwapPost,
  SwapRequest,
  User,
} from '../models/types';

const functions = getFunctions(app);

type OkResponse = { ok: true };

async function invoke<Request, Response>(
  name: string,
  data: Request,
): Promise<Response> {
  const callable = httpsCallable<Request, Response>(functions, name);
  const result = await callable(data);
  return result.data;
}

export const addPostResponseSecure = (
  postId: string,
  counterPoints?: number,
): Promise<OkResponse> =>
  invoke('addPostResponse', { postId, counterPoints });

export const removePostResponseSecure = (
  postId: string,
  responderId?: string,
): Promise<OkResponse> =>
  invoke('removePostResponse', { postId, responderId });

export const approvePostHelperSecure = (
  postId: string,
  helperId: string,
): Promise<OkResponse> =>
  invoke('approvePostHelper', { postId, helperId });

export const respondToPostCounterSecure = (
  postId: string,
  responderId: string,
  accepted: boolean,
): Promise<OkResponse> =>
  invoke('respondToPostCounter', { postId, responderId, accepted });

export const reopenPostSecure = (
  postId: string,
  dates?: { startDate: Date; endDate: Date },
): Promise<OkResponse> =>
  invoke('reopenPostSecure', {
    postId,
    startDate: dates?.startDate.toISOString(),
    endDate: dates?.endDate.toISOString(),
  });

export const rescheduleClaimedPostSecure = (
  postId: string,
  startDate: Date,
  endDate: Date,
): Promise<OkResponse> =>
  invoke('rescheduleClaimedPostSecure', {
    postId,
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
  });

export interface SubmitReviewInput {
  postId: string;
  revieweeId: string;
  targetType: ReviewTargetType;
  dogId?: string;
  dogName?: string;
  rating: number;
  note?: string;
}

export const submitReviewSecure = (
  input: SubmitReviewInput,
): Promise<{ reviewId: string }> =>
  invoke('submitReview', input);

export const clearPendingReviewSecure = (): Promise<OkResponse> =>
  invoke('clearMyPendingReview', {});

export const clearPendingReferralRewardSecure = (): Promise<OkResponse> =>
  invoke('clearMyPendingReferralReward', {});

export const acceptConductStandardsSecure = (): Promise<OkResponse> =>
  invoke('acceptConductStandards', {});

export const signMembershipAgreementSecure = (
  signedName: string,
): Promise<OkResponse & { contractVersion: string }> =>
  invoke('signMembershipAgreement', { signedName });

export const finalizeOnboardingSecure = (): Promise<OkResponse> =>
  invoke('finalizeOnboarding', {});

export interface ReferralValidation {
  valid: boolean;
  code: string;
  kind: 'promo' | 'referral' | 'invalid';
  createdBy: string | null;
}

export const validateReferralCodeSecure = (
  code: string,
): Promise<ReferralValidation> =>
  invoke('validateReferralCodeSecure', { code });

export const redeemReferralCodeSecure = (
  code: string,
): Promise<OkResponse & { kind: 'promo' | 'referral' }> =>
  invoke('redeemReferralCodeSecure', { code });

export const ensureReferralCodeSecure = (): Promise<{ code: string }> =>
  invoke('ensureReferralCodeSecure', {});

export const getReferralCountSecure = (): Promise<{ count: number }> =>
  invoke('getReferralCountSecure', {});

export const cancelCommitmentSecure = (postId: string): Promise<OkResponse> =>
  invoke('cancelCommitmentSecure', { postId });

export const completeBookingSecure = (postId: string): Promise<OkResponse> =>
  invoke('completeBookingSecure', { postId });

type ProfileUpdate = Pick<
  User,
  'displayName' | 'bio' | 'instagramHandle' | 'photoURL'
>;

export const updateMyProfileSecure = (
  profile: Partial<ProfileUpdate>,
): Promise<OkResponse> =>
  invoke('updateMyProfileSecure', { profile });

export const registerPushTokenSecure = (token: string): Promise<OkResponse> =>
  invoke('registerPushTokenSecure', { token });

type DogCreate = Omit<Dog, 'id' | 'createdAt' | 'updatedAt'>;
type DogUpdate = Partial<Omit<Dog, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'>>;

export const createDogSecure = (dog: DogCreate): Promise<{ dogId: string }> =>
  invoke('createDogSecure', { dog });

export const updateDogSecure = (
  dogId: string,
  dog: DogUpdate,
): Promise<OkResponse> =>
  invoke('updateDogSecure', { dogId, dog });

type SwapRequestCreate = Omit<SwapRequest, 'id' | 'createdAt' | 'updatedAt'>;

export const createSwapRequestSecure = (
  swap: SwapRequestCreate,
): Promise<{ swapRequestId: string }> =>
  invoke('createSwapRequestSecure', {
    swap: {
      ...swap,
      startDate: swap.startDate.toISOString(),
      endDate: swap.endDate.toISOString(),
    },
  });

export const deleteMyAccountSecure = (): Promise<OkResponse> =>
  invoke('deleteMyAccount', {});

export interface PlacesPrediction {
  placeId: string;
  description: string;
}

export const placesAutocompleteSecure = (
  input: string,
  sessionToken: string,
): Promise<{ predictions: PlacesPrediction[] }> =>
  invoke('placesAutocompleteSecure', { input, sessionToken });

export interface SecurePlaceDetails {
  formattedAddress: string;
  city: string;
  lat: number;
  lng: number;
}

export const placeDetailsSecure = (
  placeId: string,
  sessionToken: string,
): Promise<SecurePlaceDetails> =>
  invoke('placeDetailsSecure', { placeId, sessionToken });

export const getOrCreateConversationSecure = (
  otherUserId: string,
  swapRequestId?: string,
): Promise<{ conversationId: string }> =>
  invoke('getOrCreateConversationSecure', { otherUserId, swapRequestId });

export interface SecureMessageOptions {
  type?: 'text' | 'reschedule' | 'reschedule_request' | 'image' | 'help_request';
  metadata?: {
    postId?: string;
    proposedStart?: string;
    proposedEnd?: string;
    helperId?: string;
    ownerId?: string;
    caregiverId?: string;
    eventLabel?: string;
    dateLabel?: string;
  };
  imageURL?: string;
}

export const sendMessageSecure = (
  conversationId: string,
  text: string,
  options?: SecureMessageOptions,
): Promise<{ messageId: string }> =>
  invoke('sendMessageSecure', {
    conversationId,
    text,
    type: options?.type,
    metadata: options?.metadata,
    imageURL: options?.imageURL,
  });

export const createPostSecure = (
  post: Omit<SwapPost, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<{ postId: string }> => {
  const payload: Record<string, unknown> = {
    ...post,
    startDate: post.startDate.toISOString(),
    endDate: post.endDate.toISOString(),
  };
  return invoke('createPostSecure', { post: payload });
};
