import { Share } from 'react-native';
import * as Haptics from 'expo-haptics';

export const APP_LINK = 'https://joinwatchdog.com';

/**
 * Trigger the native share sheet with the standard WatchDog referral invite
 * message. Fires a haptic before opening the sheet. Safe to call from any
 * context — dismissals and cancellations are silently swallowed.
 */
export async function shareReferral(referralCode: string): Promise<void> {
  if (!referralCode) return;
  try { await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); } catch {}
  try {
    await Share.share({
      message:
        `🐾 Join me on WatchDog — neighbors helping neighbors with pet sitting, walking & more!\n\n` +
        `Use my referral code: ${referralCode}\n\n` +
        `Sign up here: ${APP_LINK}`,
      title: 'Join WatchDog',
    });
  } catch {
    // user dismissed the share sheet — ignore
  }
}

