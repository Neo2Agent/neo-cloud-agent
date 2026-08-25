/** Join Vite `BASE_URL` (`/` or `/admin/`) with an API path (`/v1/...`). */
export function joinAdminApiPath(baseUrl: string, path: string): string {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const suffix = path.startsWith("/") ? path.slice(1) : path;
  return `${base}${suffix}`;
}
