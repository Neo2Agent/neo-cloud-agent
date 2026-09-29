export function initials(value: string): string {
  const parts = value.trim().split(/[@\s./_-]+/).filter(Boolean);
  if (parts.length === 0) return "N";
  if (parts.length === 1) return parts[0]!.slice(0, 1).toUpperCase();
  return `${parts[0]!.slice(0, 1)}${parts[1]!.slice(0, 1)}`.toUpperCase();
}

export function roleLabel(role: string): string {
  if (role === "owner") return "所有者";
  if (role === "admin") return "管理员";
  return "成员";
}

export function formatRel(iso?: string | null): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  const min = Math.round(ms / 60_000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day} 天前`;
  return `${Math.max(1, Math.round(day / 30))} 个月前`;
}

export function displayName(email: string): string {
  return email.split("@")[0] || email;
}

export function repoShort(url: string): string {
  try {
    const path = new URL(url).pathname.replace(/\.git$/, "");
    return path.split("/").filter(Boolean).slice(-2).join("/") || url;
  } catch {
    return url.replace(/\/$/, "").replace(/\.git$/, "").split("/").filter(Boolean).slice(-2).join("/") || url;
  }
}
