import type { DevicePlatform } from "@neo-cloud-agent/contracts/device";
import { detectMobileSource } from "../api/source";
import { runIdFromNotificationData, shouldShowLocalPushBanner } from "../push-policy";

export type LivePushContext = {
  appInForeground: () => boolean;
  liveSse: () => boolean;
  openRunId: () => string | null;
};

async function canUseRemotePush(): Promise<boolean> {
  try {
    const Constants = await import("expo-constants");
    const ownership = Constants.default?.appOwnership ?? (Constants as { appOwnership?: string }).appOwnership;
    // Expo Go SDK 53+ removed Android remote push. Skip the module so it
    // does not console.error on import.
    return ownership !== "expo";
  } catch {
    return false;
  }
}

export async function registerExpoPushDevice(
  register: (input: { platform: DevicePlatform; pushToken: string }) => Promise<unknown>,
  userAgent = "",
): Promise<boolean> {
  try {
    if (!(await canUseRemotePush())) return false;
    const Notifications = await import("expo-notifications");
    const permission = await Notifications.requestPermissionsAsync();
    if (permission.status !== "granted") return false;
    const token = await Notifications.getExpoPushTokenAsync();
    if (!token?.data) return false;
    await register({ platform: detectMobileSource(userAgent), pushToken: token.data });
    return true;
  } catch {
    return false;
  }
}

export async function attachForegroundPushPolicy(ctx: LivePushContext): Promise<() => void> {
  try {
    if (!(await canUseRemotePush())) return () => undefined;
    const Notifications = await import("expo-notifications");
    Notifications.setNotificationHandler({
      handleNotification: async (notification) => {
        const show = shouldShowLocalPushBanner({
          appInForeground: ctx.appInForeground(),
          liveSse: ctx.liveSse(),
          notifyingRunId: runIdFromNotificationData(notification.request.content.data),
          openRunId: ctx.openRunId(),
        });
        return {
          shouldShowAlert: show,
          shouldPlaySound: show,
          shouldSetBadge: false,
          shouldShowBanner: show,
          shouldShowList: show,
        };
      },
    });
  } catch {
    return () => undefined;
  }
  return () => undefined;
}

export async function listenNotificationOpen(onRun: (runId: string) => void): Promise<() => void> {
  try {
    if (!(await canUseRemotePush())) return () => undefined;
    const Notifications = await import("expo-notifications");
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const runId = runIdFromNotificationData(response.notification.request.content.data);
      if (runId) onRun(runId);
    });
    const last = await Notifications.getLastNotificationResponseAsync();
    const initial = runIdFromNotificationData(last?.notification.request.content.data);
    if (initial) onRun(initial);
    return () => sub.remove();
  } catch {
    return () => undefined;
  }
}
