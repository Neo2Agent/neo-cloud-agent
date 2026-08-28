import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  bundledPluginById,
  listBundledPlugins,
  overlayCatalogItem,
  publicPlugin,
  sortPluginsForCatalog,
  type BundledPlugin,
  type Plugin,
  type PluginCatalogItem,
  type PluginInstall,
  type PluginInstallScope,
} from "@neo-cloud-agent/contracts";
import { canManageProject } from "@neo-cloud-agent/contracts";
import { controlStateDir } from "../store/persist.js";
import { getProject, memberRole, updateProject } from "../projects/store.js";
import { pluginPersistHooks } from "./persist-hooks.js";

export function pluginInstallsFile(): string {
  return path.join(controlStateDir(), "plugin-installs.json");
}

let memo: { file: string; items: PluginInstall[] } | null = null;

function readAll(): PluginInstall[] {
  const file = pluginInstallsFile();
  if (memo?.file === file) {
    return memo.items;
  }
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as { installs?: unknown };
    const items = Array.isArray(parsed.installs) ? parsed.installs.map(normalize).filter(Boolean) as PluginInstall[] : [];
    memo = { file, items };
    return items;
  } catch {
    memo = { file, items: [] };
    return memo.items;
  }
}

function writeAll(items: PluginInstall[], options?: { mirror?: boolean }): void {
  const file = pluginInstallsFile();
  memo = { file, items };
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ version: 1, installs: items }, null, 2)}\n`, { mode: 0o600 });
  if (options?.mirror !== false) {
    pluginPersistHooks().onWrite?.(items);
  }
}

export function replacePluginInstalls(items: PluginInstall[], options?: { mirror?: boolean }): void {
  writeAll(items.map((item) => normalize(item)).filter((item): item is PluginInstall => Boolean(item)), options);
}

export function listStoredPluginInstalls(): PluginInstall[] {
  return [...readAll()];
}

function normalize(value: unknown): PluginInstall | null {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  if (!record || typeof record.id !== "string" || typeof record.pluginId !== "string") {
    return null;
  }
  const createdAt = typeof record.createdAt === "string" ? record.createdAt : new Date().toISOString();
  return {
    id: record.id,
    pluginId: record.pluginId,
    version: typeof record.version === "string" ? record.version : "1.0.0",
    digest: typeof record.digest === "string" ? record.digest : "",
    scope: record.scope === "project" ? "project" : "user",
    ownerUserId: typeof record.ownerUserId === "string" ? record.ownerUserId : undefined,
    projectId: typeof record.projectId === "string" ? record.projectId : undefined,
    enabled: record.enabled !== false,
    createdAt,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : createdAt,
  };
}

function save(install: PluginInstall): PluginInstall {
  const items = readAll();
  const index = items.findIndex((item) => item.id === install.id);
  if (index < 0) items.push(install);
  else items[index] = install;
  writeAll(items);
  return install;
}

export function resolvePlugin(id: string): Plugin | BundledPlugin | null {
  return bundledPluginById(id);
}

export function listPluginsForActor(input: {
  userId?: string;
  projectId?: string | null;
  query?: string;
}): PluginCatalogItem[] {
  const project = input.projectId ? getProject(input.projectId) : null;
  const pinned = project?.pluginIds ?? [];
  const installs = readAll().filter((item) => installVisible(item, input.userId, project?.id));
  const catalog = listBundledPlugins().map((plugin) => {
    const install = matchingInstall(installs, plugin);
    return overlayCatalogItem(plugin, install, pinned);
  });
  const q = (input.query ?? "").trim().toLowerCase();
  const filtered = q
    ? catalog.filter((item) =>
        [item.name, item.slug, item.description, item.category, ...(item.keywords ?? [])].some((value) =>
          (value ?? "").toLowerCase().includes(q),
        ),
      )
    : catalog;
  return sortPluginsForCatalog(filtered, pinned);
}

function installVisible(item: PluginInstall, userId?: string, projectId?: string | null): boolean {
  if (item.scope === "user") {
    return Boolean(userId && item.ownerUserId === userId);
  }
  return Boolean(projectId && item.projectId === projectId);
}

function matchingInstall(installs: PluginInstall[], plugin: Plugin): PluginInstall | undefined {
  return installs.find((item) => item.pluginId === plugin.id || item.pluginId === plugin.slug);
}

export function getPluginDetail(id: string, actor: { userId?: string; projectId?: string | null }): PluginCatalogItem | null {
  const plugin = resolvePlugin(id);
  if (!plugin) return null;
  const listed = listPluginsForActor(actor).find((item) => item.id === plugin.id);
  const publicItem = listed ?? overlayCatalogItem(publicPlugin(plugin));
  const bundled = bundledPluginById(plugin.id);
  const preview = bundled?.skillContents[0]?.raw;
  return preview ? { ...publicItem, preview } : publicItem;
}

export function installPlugin(
  id: string,
  input: { scope?: PluginInstallScope; projectId?: string; enabled?: boolean },
  actor: { userId: string; email: string },
): PluginCatalogItem {
  const plugin = resolvePlugin(id);
  if (!plugin) throw new Error("插件不存在");
  const scope = input.scope === "project" ? "project" : "user";
  if (scope === "project") {
    const projectId = input.projectId?.trim() ?? "";
    if (!projectId || !getProject(projectId)) throw new Error("项目不存在");
    if (!canManageProject(memberRole(projectId, actor.userId))) throw new Error("没有权限给项目安装插件");
    const project = getProject(projectId)!;
    if (!project.pluginIds.includes(plugin.id)) {
      updateProject(projectId, { pluginIds: [...project.pluginIds, plugin.id] }, actor);
    }
    upsertInstall({
      pluginId: plugin.id,
      version: plugin.version,
      digest: plugin.source.digest,
      scope: "project",
      projectId,
      enabled: input.enabled !== false,
    });
  } else {
    upsertInstall({
      pluginId: plugin.id,
      version: plugin.version,
      digest: plugin.source.digest,
      scope: "user",
      ownerUserId: actor.userId,
      enabled: input.enabled !== false,
    });
  }
  return getPluginDetail(plugin.id, { userId: actor.userId, projectId: input.projectId }) ?? overlayCatalogItem(publicPlugin(plugin));
}

export function setPluginEnabled(
  id: string,
  input: { enabled: boolean; scope?: PluginInstallScope; projectId?: string },
  actor: { userId: string; email: string },
): PluginCatalogItem {
  const plugin = resolvePlugin(id);
  if (!plugin) throw new Error("插件不存在");
  const scope = input.scope === "project" ? "project" : "user";
  const current = findInstall(plugin.id, scope, actor.userId, input.projectId);
  if (!current) {
    return installPlugin(plugin.id, { ...input, enabled: input.enabled }, actor);
  }
  if (scope === "user" && current.ownerUserId !== actor.userId) {
    throw new Error("没有权限改这个安装");
  }
  if (scope === "project") {
    const projectId = current.projectId ?? input.projectId ?? "";
    if (!canManageProject(memberRole(projectId, actor.userId))) throw new Error("没有权限改项目插件");
  }
  save({ ...current, enabled: input.enabled, updatedAt: new Date().toISOString() });
  return getPluginDetail(plugin.id, { userId: actor.userId, projectId: input.projectId ?? current.projectId }) ?? overlayCatalogItem(publicPlugin(plugin));
}

export function uninstallPlugin(
  id: string,
  input: { scope?: PluginInstallScope; projectId?: string },
  actor: { userId: string; email: string },
): void {
  const plugin = resolvePlugin(id);
  if (!plugin) throw new Error("插件不存在");
  const scope = input.scope === "project" ? "project" : "user";
  const current = findInstall(plugin.id, scope, actor.userId, input.projectId);
  if (!current) return;
  if (scope === "user" && current.ownerUserId !== actor.userId) {
    throw new Error("没有权限卸这个安装");
  }
  if (scope === "project") {
    const projectId = current.projectId ?? input.projectId ?? "";
    if (!canManageProject(memberRole(projectId, actor.userId))) throw new Error("没有权限卸项目插件");
    const project = getProject(projectId);
    if (project) {
      updateProject(projectId, { pluginIds: project.pluginIds.filter((item) => item !== plugin.id && item !== plugin.slug) }, actor);
    }
  }
  writeAll(readAll().filter((item) => item.id !== current.id));
}

function findInstall(pluginId: string, scope: PluginInstallScope, userId: string, projectId?: string): PluginInstall | undefined {
  return readAll().find((item) => {
    if (item.pluginId !== pluginId && item.pluginId !== bundledPluginById(pluginId)?.slug) return false;
    if (item.scope !== scope) return false;
    if (scope === "user") return item.ownerUserId === userId;
    return item.projectId === projectId;
  });
}

function upsertInstall(input: Omit<PluginInstall, "id" | "createdAt" | "updatedAt">): PluginInstall {
  const existing = readAll().find((item) => {
    if (item.pluginId !== input.pluginId || item.scope !== input.scope) return false;
    if (input.scope === "user") return item.ownerUserId === input.ownerUserId;
    return item.projectId === input.projectId;
  });
  const now = new Date().toISOString();
  if (existing) {
    return save({ ...existing, ...input, updatedAt: now });
  }
  return save({
    id: `inst_${randomUUID().slice(0, 8)}`,
    ...input,
    createdAt: now,
    updatedAt: now,
  });
}

export function resolveEnabledPlugins(input: {
  userId?: string;
  projectId?: string | null;
  extraIds?: string[];
}): BundledPlugin[] {
  const project = input.projectId ? getProject(input.projectId) : null;
  const bySlug = new Map<string, BundledPlugin>();
  const consider = (id: string) => {
    const plugin = bundledPluginById(id);
    if (plugin) bySlug.set(plugin.slug, plugin);
  };
  for (const install of readAll()) {
    if (!install.enabled) continue;
    if (install.scope === "user" && install.ownerUserId === input.userId) {
      consider(install.pluginId);
    }
    if (install.scope === "project" && install.projectId === project?.id) {
      consider(install.pluginId);
    }
  }
  for (const id of project?.pluginIds ?? []) {
    consider(id);
  }
  for (const id of input.extraIds ?? []) {
    consider(id);
  }
  return [...bySlug.values()];
}
