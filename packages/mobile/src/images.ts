/**
 * Attachment rules shared by both shells. The transport is the existing cloud
 * field `CreateRunRequest.images`, so nothing here talks to the control plane.
 *
 * Phones hand back originals: Expo SDK 54's picker defaults to `Passthrough`,
 * so an iPhone photo arrives as multi-megabyte HEIC. The worker only maps
 * png/webp/gif extensions and passes `mediaType` straight to the model as the
 * vision mime type, so anything but JPEG/PNG lands wrong twice. Both shells
 * therefore re-encode to JPEG and downscale before building an `ImageRef`.
 */
import type { ImageRef } from "@neo-cloud-agent/contracts/run";

/** The worker already truncates with `images.slice(0, 4)`; match it client-side. */
export const MAX_IMAGES = 4;

/** Long edge after downscaling. Keeps a 12MP photo near 200-400KB at MAX_IMAGE_QUALITY. */
export const MAX_IMAGE_EDGE = 1600;

export const MAX_IMAGE_QUALITY = 0.7;

/** Normalizing to JPEG keeps the worker's extension map and the model's mime type honest. */
export const NORMALIZED_MEDIA_TYPE = "image/jpeg";

/** Soft ceiling for one request. `readRawBody` has no cap, so stay well under it. */
export const IMAGE_BUDGET_BYTES = 6 * 1024 * 1024;

export function fitWithin(
  width: number,
  height: number,
  maxEdge = MAX_IMAGE_EDGE,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (!Number.isFinite(longest) || longest <= 0) return { width: 0, height: 0 };
  if (longest <= maxEdge) return { width: Math.round(width), height: Math.round(height) };
  const scale = maxEdge / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Decoded byte count of a base64 payload, without allocating the buffer. */
export function base64Bytes(data: string): number {
  const raw = data.includes(",") ? data.slice(data.indexOf(",") + 1) : data;
  const padding = raw.endsWith("==") ? 2 : raw.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((raw.length * 3) / 4) - padding);
}

export function totalImageBytes(images: ImageRef[]): number {
  return images.reduce((sum, item) => sum + base64Bytes(item.data), 0);
}

/** Cap the attachment list the same way the worker does, newest picks last. */
export function acceptImages(current: ImageRef[], picked: ImageRef[]): ImageRef[] {
  return [...current, ...picked].slice(0, MAX_IMAGES);
}

export function canAttachMore(current: ImageRef[]): boolean {
  return current.length < MAX_IMAGES;
}

export function imageHint(images: ImageRef[]): string {
  if (images.length === 0) return "";
  const bytes = totalImageBytes(images);
  const mb = bytes / (1024 * 1024);
  const size = mb >= 1 ? `${mb.toFixed(1)}MB` : `${Math.max(1, Math.round(bytes / 1024))}KB`;
  if (bytes > IMAGE_BUDGET_BYTES) return `${images.length} 张 · ${size}，太大了，删掉一张再发`;
  return `${images.length}/${MAX_IMAGES} 张 · ${size}`;
}

export function overImageBudget(images: ImageRef[]): boolean {
  return totalImageBytes(images) > IMAGE_BUDGET_BYTES;
}

export function jpegImageRef(base64: string): ImageRef {
  return { mediaType: NORMALIZED_MEDIA_TYPE, data: base64.includes(",") ? base64.slice(base64.indexOf(",") + 1) : base64 };
}
