import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ImageRef, WorkerInbound } from "@neo-cloud-agent/contracts";

export type PiImageContent = {
  type: "image";
  data: string;
  mimeType: string;
};

export function rawImageData(data: string): string {
  return data.includes(",") ? data.slice(data.indexOf(",") + 1) : data;
}

export function toPiImageContent(images?: ImageRef[]): PiImageContent[] {
  if (!images?.length) {
    return [];
  }
  return images.slice(0, 4).map((image) => ({
    type: "image" as const,
    data: rawImageData(image.data),
    mimeType: image.mediaType || "image/png",
  }));
}

export function materializeInboundImages(
  cwd: string,
  images?: ImageRef[],
): { note: string; files: string[] } {
  if (!images?.length) {
    return { note: "", files: [] };
  }
  const dir = path.join(cwd, ".neo", "inbox-images");
  mkdirSync(dir, { recursive: true });
  const files: string[] = [];
  images.slice(0, 4).forEach((image, index) => {
    const ext =
      image.mediaType === "image/png"
        ? "png"
        : image.mediaType === "image/webp"
          ? "webp"
          : image.mediaType === "image/gif"
            ? "gif"
            : "jpg";
    const name = `paste-${index + 1}.${ext}`;
    const dest = path.join(dir, name);
    writeFileSync(dest, Buffer.from(rawImageData(image.data), "base64"));
    files.push(path.posix.join(".neo/inbox-images", name));
  });
  return {
    files,
    note: `User attached ${files.length} image(s). Saved under:\n${files.map((file) => `- ${file}`).join("\n")}`,
  };
}

export function inboundPrompt(
  cwd: string,
  message: Extract<WorkerInbound, { text: string }>,
): { text: string; images: PiImageContent[] } {
  const attached = materializeInboundImages(cwd, message.images);
  const images = toPiImageContent(message.images);
  const note = images.length
    ? `User attached ${images.length} image(s) as vision input.${
        attached.files.length ? ` Also saved under:\n${attached.files.map((file) => `- ${file}`).join("\n")}` : ""
      }`
    : attached.note;
  return {
    text: note ? `${message.text}\n\n${note}` : message.text,
    images,
  };
}
