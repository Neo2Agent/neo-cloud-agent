import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { ProjectAsset } from "@neo-cloud-agent/contracts/project-asset";
import { getObjectStore } from "../objects/store.js";
import { controlStateDir } from "../store/persist.js";
import { canManageProject } from "@neo-cloud-agent/contracts";
import { getProject, memberRole, projectHasMember, recordProjectEvent } from "./store.js";

export const PROJECT_ASSET_QUOTA = 1024 * 1024 * 1024;

let memo: { file: string; items: ProjectAsset[] } | null = null;

function assetsFile(): string {
  return path.join(controlStateDir(), "project-assets.json");
}

function readAll(): ProjectAsset[] {
  const file = assetsFile();
  if (memo?.file === file) return memo.items;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as { assets?: ProjectAsset[] };
    const items = Array.isArray(parsed.assets) ? parsed.assets : [];
    memo = { file, items };
    return items;
  } catch {
    memo = { file, items: [] };
    return memo.items;
  }
}

function writeAll(items: ProjectAsset[]): void {
  const file = assetsFile();
  memo = { file, items };
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ version: 1, assets: items }, null, 2)}\n`, { mode: 0o600 });
}

function requireMember(projectId: string, userId: string): void {
  if (!getProject(projectId) || !projectHasMember(projectId, userId)) {
    throw new Error("项目不存在");
  }
}

export function listProjectAssets(projectId: string, actorUserId: string): ProjectAsset[] {
  requireMember(projectId, actorUserId);
  return listProjectAssetsUnchecked(projectId);
}

export function listProjectAssetsUnchecked(projectId: string): ProjectAsset[] {
  return readAll().filter((item) => item.projectId === projectId).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function projectAssetBytes(projectId: string): number {
  return readAll().filter((item) => item.projectId === projectId).reduce((sum, item) => sum + item.size, 0);
}

export async function putProjectAsset(
  projectId: string,
  input: {
    path: string;
    body: Buffer;
    contentType?: string;
    source: "upload" | "run";
    runId?: string | null;
  },
  actor: { userId: string; email: string },
): Promise<ProjectAsset> {
  requireMember(projectId, actor.userId);
  const rel = input.path.trim().replaceAll("\\", "/").replace(/^\/+/, "");
  if (!rel || rel.includes("..")) throw new Error("路径不合法");
  if (input.body.length === 0) throw new Error("文件是空的");
  const items = readAll();
  const existing = items.find((item) => item.projectId === projectId && item.path === rel);
  const used = projectAssetBytes(projectId) - (existing?.size ?? 0);
  if (used + input.body.length > PROJECT_ASSET_QUOTA) {
    recordProjectEvent(projectId, actor, "asset_quota", "上传被配额拦住了");
    throw new Error("项目资产超过 1 GB");
  }
  const now = new Date().toISOString();
  const id = existing?.id ?? `asset_${randomUUID().slice(0, 8)}`;
  const objectKey = existing?.objectKey ?? `project/${projectId}/assets/${id}`;
  await getObjectStore().put(objectKey, input.body.toString("base64"), input.contentType || "application/octet-stream");
  const asset: ProjectAsset = {
    id,
    projectId,
    path: rel,
    objectKey,
    size: input.body.length,
    contentType: input.contentType || "application/octet-stream",
    createdBy: existing?.createdBy ?? actor.userId,
    createdEmail: existing?.createdEmail ?? actor.email,
    source: input.source,
    runId: input.runId ?? null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    updatedBy: actor.userId,
    updatedEmail: actor.email,
  };
  writeAll([...items.filter((item) => item.id !== id), asset]);
  recordProjectEvent(projectId, actor, existing ? "asset_updated" : "asset_saved", existing ? `更新了 ${rel}` : `保存了 ${rel}`);
  return asset;
}

export async function readProjectAsset(projectId: string, assetId: string, actorUserId: string): Promise<{ asset: ProjectAsset; body: Buffer } | null> {
  requireMember(projectId, actorUserId);
  const asset = readAll().find((item) => item.projectId === projectId && item.id === assetId);
  if (!asset) return null;
  const raw = await getObjectStore().get(asset.objectKey);
  if (!raw) return null;
  return { asset, body: Buffer.from(raw, "base64") };
}

const MAX_ATTACHED_ASSETS = 16;
const MAX_ATTACHED_BYTES = 8 * 1024 * 1024;

export function normalizeAssetIds(raw?: string[]): string[] {
  return [...new Set((raw ?? []).map((item) => item.trim()).filter(Boolean))].slice(0, MAX_ATTACHED_ASSETS);
}

function attachedFileName(assetPath: string, id: string, used: Set<string>): string {
  const base = path.basename(assetPath.replaceAll("\\", "/")).replace(/[^\w.\u4e00-\u9fff-]+/g, "_") || id;
  let name = base;
  let n = 1;
  while (used.has(name)) {
    const ext = path.extname(base);
    name = `${path.basename(base, ext)}-${n}${ext}`;
    n += 1;
  }
  used.add(name);
  return name;
}

export async function attachProjectAssetsToWorkspace(input: {
  projectId: string;
  userId: string;
  workspaceDir: string;
  assetIds: string[];
}): Promise<{ attached: string[]; skipped: string[] }> {
  const attached: string[] = [];
  const skipped: string[] = [];
  const used = new Set<string>();
  const destDir = path.join(input.workspaceDir, ".neo", "attached");
  for (const assetId of normalizeAssetIds(input.assetIds)) {
    const found = await readProjectAsset(input.projectId, assetId, input.userId).catch(() => null);
    if (!found) {
      skipped.push(assetId);
      continue;
    }
    if (found.body.length > MAX_ATTACHED_BYTES) {
      skipped.push(found.asset.path);
      continue;
    }
    const name = attachedFileName(found.asset.path, found.asset.id, used);
    mkdirSync(destDir, { recursive: true });
    writeFileSync(path.join(destDir, name), found.body);
    attached.push(name);
  }
  return { attached, skipped };
}

export function deleteProjectAsset(projectId: string, assetId: string, actor: { userId: string; email: string }): void {
  requireMember(projectId, actor.userId);
  if (!canManageProject(memberRole(projectId, actor.userId))) {
    throw new Error("没有权限删除资产");
  }
  const items = readAll();
  const found = items.find((item) => item.projectId === projectId && item.id === assetId);
  if (!found) throw new Error("资产不存在");
  writeAll(items.filter((item) => item.id !== assetId));
  recordProjectEvent(projectId, actor, "asset_deleted", `删除了 ${found.path}`);
}
