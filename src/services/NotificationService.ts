import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { SPLASH_COLOR } from '../config/theme';
import { registerPushTokenSecure } from './secureOperations';

// Track which conversation the user is currently viewing
let activeConversationId: string | null = null;

export const setActiveConversation = (convId: string | null): void => {
  activeConversationId = convId;
};

Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    // Suppress notification if user is viewing the conversation it's about
    const data = notification.request.content.data;
    if (
      data?.type === 'new_message' &&
      data?.conversationId &&
      data.conversationId === activeConversationId
    ) {
      return {
        shouldShowAlert: false,
        shouldPlaySound: false,
        shouldSetBadge: false,
        shouldShowBanner: false,
        shouldShowList: false,
      };
    }

    return {
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    };
  },
});

export const registerForPushNotifications = async (): Promise<string | null> => {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: SPLASH_COLOR,
    });
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    return null;
  }

  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;

  if (!projectId) {
    return null;
  }

  try {
    const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
    return tokenData.data;
  } catch {
    return null;
  }
};

export const savePushToken = async (userId: string, token: string): Promise<void> => {
  void userId;
  await registerPushTokenSecure(token);
};

export const scheduleLocalNotification = async (
  title: string,
  body: string,
  seconds = 1
): Promise<string> => {
  return Notifications.scheduleNotificationAsync({
    content: { title, body, sound: true },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds, repeats: false },
  });
};

export const addNotificationReceivedListener = (
  handler: (notification: Notifications.Notification) => void
): Notifications.EventSubscription => {
  return Notifications.addNotificationReceivedListener(handler);
};

export const addNotificationResponseListener = (
  handler: (response: Notifications.NotificationResponse) => void
): Notifications.EventSubscription => {
  return Notifications.addNotificationResponseReceivedListener(handler);
};
