import * as StoreReview from 'expo-store-review';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert, Linking, Platform } from 'react-native';

const STORAGE_KEY = '@watchdog_review_state';
const APP_STORE_ID = '6771696896';

interface ReviewState {
  hasReviewed: boolean;
  postsCreated: number;
  postsAccepted: number;  // times owner accepted a caregiver
  promptedAfter1stPost: boolean;
  promptedAfter5thPost: boolean;
  promptedAfter1stAccept: boolean;
  promptedAfter3rdAccept: boolean;
}

const DEFAULT_STATE: ReviewState = {
  hasReviewed: false,
  postsCreated: 0,
  postsAccepted: 0,
  promptedAfter1stPost: false,
  promptedAfter5thPost: false,
  promptedAfter1stAccept: false,
  promptedAfter3rdAccept: false,
};

async function getState(): Promise<ReviewState> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_STATE };
    return { ...DEFAULT_STATE, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

async function saveState(state: ReviewState): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // non-fatal
  }
}

/**
 * Show a two-step prompt: first ask "Enjoying WatchDog?" —
 * if yes, open the native App Store review dialog.
 */
function showReviewPrompt(): void {
  Alert.alert(
    'Enjoying WatchDog? 🐾',
    'We\'d love to hear from you! Would you like to leave a review?',
    [
      { text: 'Not Now', style: 'cancel' },
      {
        text: 'Yes, Review!',
        onPress: async () => {
          const state = await getState();
          state.hasReviewed = true;
          await saveState(state);

          const canUseNative = await StoreReview.isAvailableAsync();
          if (canUseNative) {
            await StoreReview.requestReview();
          } else if (Platform.OS === 'ios') {
            Linking.openURL(
              `https://apps.apple.com/app/id${APP_STORE_ID}?action=write-review`
            );
          }
        },
      },
    ]
  );
}

/**
 * Call after a post is successfully created.
 */
export async function onPostCreated(): Promise<void> {
  const state = await getState();
  if (state.hasReviewed) return;

  state.postsCreated += 1;
  await saveState(state);

  // Trigger 1: after 1st post
  if (state.postsCreated === 1 && !state.promptedAfter1stPost) {
    state.promptedAfter1stPost = true;
    await saveState(state);
    setTimeout(() => showReviewPrompt(), 2000); // delay so celebration finishes
    return;
  }

  // Trigger 2: after 5th post
  if (state.postsCreated === 5 && !state.promptedAfter5thPost) {
    state.promptedAfter5thPost = true;
    await saveState(state);
    setTimeout(() => showReviewPrompt(), 2000);
    return;
  }
}

/**
 * Call after the post owner approves/accepts a caregiver.
 */
export async function onPostAccepted(): Promise<void> {
  const state = await getState();
  if (state.hasReviewed) return;

  state.postsAccepted += 1;
  await saveState(state);

  // Trigger 3: after 1st accepted post
  if (state.postsAccepted === 1 && !state.promptedAfter1stAccept) {
    state.promptedAfter1stAccept = true;
    await saveState(state);
    setTimeout(() => showReviewPrompt(), 2000);
    return;
  }

  // Trigger 4: after 3rd accepted post
  if (state.postsAccepted === 3 && !state.promptedAfter3rdAccept) {
    state.promptedAfter3rdAccept = true;
    await saveState(state);
    setTimeout(() => showReviewPrompt(), 2000);
    return;
  }

  // Trigger 5: every 5 accepted posts after all above prompts are exhausted
  if (
    state.promptedAfter1stAccept &&
    state.promptedAfter3rdAccept &&
    state.postsAccepted > 3 &&
    (state.postsAccepted - 3) % 5 === 0
  ) {
    setTimeout(() => showReviewPrompt(), 2000);
  }
}
