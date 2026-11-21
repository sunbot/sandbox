import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

/** Subtle feedback on devices that support it; silently nothing on web. */
export const haptic = {
  select: () => { if (Platform.OS !== 'web') Haptics.selectionAsync().catch(() => undefined); },
  success: () => { if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined); },
};
