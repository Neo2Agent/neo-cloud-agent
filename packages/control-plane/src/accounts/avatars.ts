import type { UserAvatar } from "./types.js";

export const MAX_AVATAR_BYTES = 200 * 1024;

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export class AvatarError extends Error {
  constructor(message = "invalid avatar") {
    super(message);
  }
}

function normalizeContentType(raw: string): string {
  const type = raw.trim().toLowerCase().split(";")[0]?.trim() ?? "";
  if (type === "image/jpg") {
    return "image/jpeg";
  }
  return type;
}

export function parseAvatarInput(value: unknown): UserAvatar | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    throw new AvatarError("invalid avatar");
  }
  const match = /^data:([^,]+);base64,([\s\S]+)$/i.exec(value.trim());
  if (!match) {
    throw new AvatarError("invalid avatar");
  }
  const contentType = normalizeContentType(match[1] ?? "");
  if (!ALLOWED_TYPES.has(contentType)) {
    throw new AvatarError("invalid avatar");
  }
  const data = (match[2] ?? "").replace(/\s+/g, "");
  if (!data) {
    throw new AvatarError("invalid avatar");
  }
  let bytes: Buffer;
  try {
    bytes = Buffer.from(data, "base64");
  } catch {
    throw new AvatarError("invalid avatar");
  }
  if (!bytes.length || bytes.length > MAX_AVATAR_BYTES) {
    throw new AvatarError("avatar too large");
  }
  return { contentType, data };
}
