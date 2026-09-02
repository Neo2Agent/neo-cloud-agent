import type { ImageRef } from "@neo-cloud-agent/contracts/run";

export function readImageRef(file: File): Promise<ImageRef> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("read image failed"));
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      resolve({
        mediaType: file.type || "image/png",
        data: comma >= 0 ? result.slice(comma + 1) : result,
      });
    };
    reader.readAsDataURL(file);
  });
}
