/**
 * Browser side of attachment picking, used by the :5175 lab. A canvas re-encode
 * gives the same JPEG normalization the RN shell gets from expo-image-manipulator,
 * with no extra dependency.
 */
import type { ImageRef } from "@neo-cloud-agent/contracts/run";
import { fitWithin, jpegImageRef, MAX_IMAGE_EDGE, MAX_IMAGE_QUALITY, MAX_IMAGES } from "../images";

function loadBitmap(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("读不出这张图"));
    };
    image.src = url;
  });
}

export async function fileToImageRef(file: File): Promise<ImageRef> {
  const bitmap = await loadBitmap(file);
  const size = fitWithin(bitmap.naturalWidth || bitmap.width, bitmap.naturalHeight || bitmap.height, MAX_IMAGE_EDGE);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("这个浏览器不支持缩放图片");
  context.drawImage(bitmap, 0, 0, size.width, size.height);
  return jpegImageRef(canvas.toDataURL("image/jpeg", MAX_IMAGE_QUALITY));
}

export async function filesToImageRefs(files: FileList | File[] | null): Promise<ImageRef[]> {
  const picked = [...(files ?? [])].filter((file) => file.type.startsWith("image/")).slice(0, MAX_IMAGES);
  return Promise.all(picked.map(fileToImageRef));
}
