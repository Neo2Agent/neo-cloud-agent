/**
 * Native side of attachment picking. Mirrors `src/web/pick-images.ts`: both end
 * up producing the same normalized JPEG `ImageRef` for the cloud `images[]` field.
 *
 * The normalization is not cosmetic. Expo SDK 54's picker defaults to
 * `Passthrough`, so an iPhone photo comes back as a multi-megabyte HEIC. The
 * worker's extension map only knows png/webp/gif and hands `mediaType` to the
 * model as the vision mime type, so HEIC would be written as a mislabelled
 * `.jpg` and rejected upstream. Re-encoding here fixes format and size at once.
 */
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import type { ImageRef } from "@neo-cloud-agent/contracts/run";
import { fitWithin, jpegImageRef, MAX_IMAGE_EDGE, MAX_IMAGE_QUALITY, MAX_IMAGES } from "../images";

export class ImagePickError extends Error {}

type Asset = { uri: string; width?: number | null; height?: number | null };

async function toImageRef(asset: Asset): Promise<ImageRef> {
  const context = ImageManipulator.manipulate(asset.uri);
  const width = asset.width ?? 0;
  const height = asset.height ?? 0;
  // Only shrink. `resize` would happily upscale a small screenshot.
  if (Math.max(width, height) > MAX_IMAGE_EDGE) {
    context.resize(fitWithin(width, height, MAX_IMAGE_EDGE));
  } else if (!width || !height) {
    // Dimensions unknown: bound the long edge and let the ratio follow.
    context.resize({ width: MAX_IMAGE_EDGE });
  }
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({
    compress: MAX_IMAGE_QUALITY,
    format: SaveFormat.JPEG,
    base64: true,
  });
  if (!saved.base64) {
    throw new ImagePickError("图片转码失败");
  }
  return jpegImageRef(saved.base64);
}

async function normalize(assets: Asset[], room: number): Promise<ImageRef[]> {
  const picked = assets.slice(0, Math.max(0, room));
  const out: ImageRef[] = [];
  for (const asset of picked) {
    out.push(await toImageRef(asset));
  }
  return out;
}

/** Returns an empty list when the user cancels, so callers do not special-case it. */
export async function pickImagesFromLibrary(current = 0): Promise<ImageRef[]> {
  const room = MAX_IMAGES - current;
  if (room <= 0) return [];
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    throw new ImagePickError("没有相册权限。到系统设置里允许 Neo 读取照片。");
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: "images",
    allowsMultipleSelection: room > 1,
    selectionLimit: room,
  });
  if (result.canceled) return [];
  return normalize(result.assets, room);
}

export async function takePhoto(current = 0): Promise<ImageRef[]> {
  if (MAX_IMAGES - current <= 0) return [];
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) {
    throw new ImagePickError("没有相机权限。到系统设置里允许 Neo 使用相机。");
  }
  const result = await ImagePicker.launchCameraAsync({ mediaTypes: "images" });
  if (result.canceled) return [];
  return normalize(result.assets, 1);
}
