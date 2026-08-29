const MAX_EDGE = 256;
const QUALITY = 0.85;

export function compressAvatarFile(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    return Promise.reject(new Error("请选择图片"));
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, MAX_EDGE / Math.max(image.width, image.height, 1));
      const width = Math.max(1, Math.round(image.width * scale));
      const height = Math.max(1, Math.round(image.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) {
        reject(new Error("无法处理图片"));
        return;
      }
      context.drawImage(image, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", QUALITY));
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("无法读取图片"));
    };
    image.src = url;
  });
}
