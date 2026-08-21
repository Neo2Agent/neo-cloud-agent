import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ImageRef } from "@neo-cloud-agent/contracts";

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
    const raw = image.data.includes(",") ? image.data.slice(image.data.indexOf(",") + 1) : image.data;
    writeFileSync(dest, Buffer.from(raw, "base64"));
    files.push(path.posix.join(".neo/inbox-images", name));
  });
  return {
    files,
    note: `User attached ${files.length} image(s). Saved under:\n${files.map((file) => `- ${file}`).join("\n")}`,
  };
}
