const FALLBACK_IMAGE_MEDIA_TYPE = "image/jpeg";

type TranscriptImage = { mediaType?: string; data?: string; href?: string };

/**
 * Pick what an `<img>` should load for a chat photo.
 *
 * A transcript page asked with `images=href` carries no bytes, so the browser
 * fetches the image once and can cache it instead of re-parsing base64 on every
 * poll. The token rides in the query like the run event stream does, because an
 * `<img>` cannot send an Authorization header.
 *
 * Locally attached images (not yet sent) still arrive as raw base64.
 */
export function transcriptUserImageSrc(
  image: TranscriptImage,
  token: string,
  withBase: (path: string) => string = (path) => path,
): string {
  const href = image.href?.trim();
  if (href) {
    const url = withBase(href);
    if (!token) {
      return url;
    }
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}access_token=${encodeURIComponent(token)}`;
  }
  const data = image.data?.trim();
  if (!data) {
    return "";
  }
  if (data.startsWith("data:")) {
    return data;
  }
  return `data:${image.mediaType || FALLBACK_IMAGE_MEDIA_TYPE};base64,${data}`;
}
