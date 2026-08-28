export type DevicePlatform = "ios" | "android";

export interface Device {
  id: string;
  userId: string;
  orgId: string;
  platform: DevicePlatform;
  /** Present on create/upsert. Omitted from list responses. */
  pushToken?: string;
  createdAt: string;
  lastSeenAt: string;
}

export interface CreateDeviceRequest {
  platform: DevicePlatform;
  pushToken: string;
}

export function parseDevicePlatform(value: unknown): DevicePlatform | undefined {
  return value === "ios" || value === "android" ? value : undefined;
}
