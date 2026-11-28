import { Platform, Linking } from 'react-native';
import * as Notifications from 'expo-notifications';

export const NEXUS_CHANNEL_ID = 'nexus-alerts';

try {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });
} catch {
  // Ignore if running in unsupported environment
}

export async function ensureNotificationChannel() {
  if (Platform.OS !== 'android') return;
  try {
    await Notifications.setNotificationChannelAsync(NEXUS_CHANNEL_ID, {
      name: 'Nexus CRM Alerts',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 200, 250],
      lightColor: '#2563eb',
      sound: 'default',
      enableVibrate: true,
      showBadge: true,
    });
  } catch {
    // Non-blocking
  }
}

export async function getPhoneNotificationPermission() {
  try {
    const settings = await Notifications.getPermissionsAsync();
    const granted =
      settings.granted ||
      settings.ios?.status === Notifications.IosAuthorizationStatus?.PROVISIONAL;
    return {
      granted: Boolean(granted),
      status: settings.status,
      canAskAgain: settings.canAskAgain !== false,
    };
  } catch {
    return { granted: false, status: 'undetermined', canAskAgain: true };
  }
}

export async function requestPhoneNotificationPermission() {
  try {
    await ensureNotificationChannel();
    const current = await Notifications.getPermissionsAsync();
    if (
      current.granted ||
      current.ios?.status === Notifications.IosAuthorizationStatus?.PROVISIONAL
    ) {
      return { granted: true, status: current.status, canAskAgain: true };
    }

    const asked = await Notifications.requestPermissionsAsync({
      ios: {
        allowAlert: true,
        allowBadge: true,
        allowSound: true,
      },
    });

    const granted =
      asked.granted ||
      asked.ios?.status === Notifications.IosAuthorizationStatus?.PROVISIONAL;

    return {
      granted: Boolean(granted),
      status: asked.status,
      canAskAgain: asked.canAskAgain !== false,
    };
  } catch {
    return { granted: false, status: 'denied', canAskAgain: false };
  }
}

export async function openAppNotificationSettings() {
  try {
    await Linking.openSettings();
  } catch {
    // Ignore
  }
}

export async function sendLocalPhoneNotification({ title, body, data = {} }) {
  try {
    const perm = await getPhoneNotificationPermission();
    if (!perm.granted) return false;
    await ensureNotificationChannel();
    await Notifications.scheduleNotificationAsync({
      content: {
        title: title || 'Nexus CRM',
        body: body || '',
        data,
        sound: 'default',
        ...(Platform.OS === 'android' ? { channelId: NEXUS_CHANNEL_ID } : {}),
      },
      trigger: null,
    });
    return true;
  } catch {
    return false;
  }
}

export function addNotificationResponseListener(handler) {
  try {
    return Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response?.notification?.request?.content?.data || {};
      if (handler) handler(data);
    });
  } catch {
    return { remove: () => {} };
  }
}
