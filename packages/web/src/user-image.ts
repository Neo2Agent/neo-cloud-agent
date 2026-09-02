export function transcriptUserImageSrc(
  image: { mediaType?: string; data?: string; href?: string },
  token: string,
  withBase: (path: string) => string = (path) => path,
): string {
  const href = image.href?.trim();
  if (href) {
    const url = withBase(href);
    if (!token) {
      return url;
    }
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}access_token=${encodeURIComponent(token)}`;
  }
  const data = image.data?.trim();
  if (!data) {
    return "";
  }
  if (data.startsWith("data:")) {
    return data;
  }
  return `data:${image.mediaType || "image/jpeg"};base64,${data}`;
}
