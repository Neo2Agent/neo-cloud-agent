import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { rawTranscriptImageData, type ImageRef, type WorkerInbound } from "@neo-cloud-agent/contracts";

export type PiImageContent = {
  type: "image";
  data: string;
  mimeType: string;
};

export function toPiImageContent(images?: ImageRef[]): PiImageContent[] {
  if (!images?.length) {
    return [];
  }
  return images.slice(0, 4).map((image) => ({
    type: "image" as const,
    data: rawTranscriptImageData(image.data),
    mimeType: image.mediaType || "image/png",
  }));
}

/**
 * Write pasted images next to the workspace so the agent can read them by path.
 *
 * `scratchDir` keeps two runs sharing one folder from overwriting each other's
 * `paste-1.png`. It has to stay inside `cwd`: the paths handed to the model are
 * relative, and the desk sandbox refuses anything outside the workspace root.
 */
export function materializeInboundImages(
  cwd: string,
  images?: ImageRef[],
  scratchDir?: string,
): { note: string; files: string[] } {
  if (!images?.length) {
    return { note: "", files: [] };
  }
  const root = scratchDir && path.resolve(scratchDir).startsWith(path.resolve(cwd) + path.sep)
    ? path.resolve(scratchDir)
    : path.join(cwd, ".neo");
  const dir = path.join(root, "inbox-images");
  mkdirSync(dir, { recursive: true });
  const relativeDir = path.relative(path.resolve(cwd), dir).split(path.sep).join("/");
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
    writeFileSync(dest, Buffer.from(rawTranscriptImageData(image.data), "base64"));
    files.push(path.posix.join(relativeDir, name));
  });
  return {
    files,
    note: `User attached ${files.length} image(s). Saved under:\n${files.map((file) => `- ${file}`).join("\n")}`,
  };
}

export function inboundPrompt(
  cwd: string,
  message: Extract<WorkerInbound, { text: string }>,
  scratchDir?: string,
): { text: string; images: PiImageContent[] } {
  const attached = materializeInboundImages(cwd, message.images, scratchDir);
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
