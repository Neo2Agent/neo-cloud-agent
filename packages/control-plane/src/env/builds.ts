import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Build, CreateBuildRequest, Environment, EnvironmentJson } from "@neo-cloud-agent/contracts";
import { getConfig } from "../config.js";
import { materializeRepos, copyWorkspaceTree } from "../scm/workspace.js";
import { controlStateDir } from "../store/persist.js";
import { repoRoot } from "../worker-spawn.js";
import { findInstallTargets, runInstallCommand } from "./install.js";
import { environmentFingerprint } from "./fingerprint.js";
import { getEnvironment, upsertEnvironment } from "./store.js";
import { refillWarmPool } from "./warm-pool.js";

function now(): string {
  return new Date().toISOString();
}

function buildsDir(runsDir = getConfig().runsDir): string {
  return path.join(controlStateDir(runsDir), "builds");
}

function buildFile(id: string, runsDir?: string): string {
  return path.join(buildsDir(runsDir), `${id}.json`);
}

export function snapshotPathFor(buildId: string, runsDir = getConfig().runsDir): string {
  return path.join(runsDir, ".builds", buildId, "workspace");
}

function writeBuild(build: Build, runsDir?: string): void {
  mkdirSync(path.dirname(buildFile(build.id, runsDir)), { recursive: true });
  const tmp = `${buildFile(build.id, runsDir)}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(build, null, 2)}\n`);
  renameSync(tmp, buildFile(build.id, runsDir));
}

export function getBuild(id: string, runsDir?: string): Build | undefined {
  try {
    return JSON.parse(readFileSync(buildFile(id, runsDir), "utf8")) as Build;
  } catch {
    return undefined;
  }
}

export function listBuilds(runsDir = getConfig().runsDir): Build[] {
  try {
    return readdirSync(buildsDir(runsDir))
      .filter((name) => name.endsWith(".json") && !name.endsWith(".tmp"))
      .map((name) => {
        try {
          return JSON.parse(readFileSync(path.join(buildsDir(runsDir), name), "utf8")) as Build;
        } catch {
          return null;
        }
      })
      .filter((item): item is Build => Boolean(item?.id))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    return [];
  }
}

export function listBuildsForEnv(envId: string, runsDir?: string): Build[] {
  return listBuilds(runsDir).filter((item) => item.envId === envId);
}

export function findActiveBuild(fingerprint: string, runsDir?: string): Build | undefined {
  return listBuilds(runsDir).find(
    (item) =>
      item.fingerprint === fingerprint &&
      item.status === "SUCCEEDED" &&
      !item.draft &&
      Boolean(item.snapshotPath),
  );
}

export function readBuildLogs(id: string, runsDir?: string): string {
  try {
    return readFileSync(buildLogFile(id, runsDir), "utf8");
  } catch {
    return getBuild(id, runsDir)?.failureMessage ?? "";
  }
}

function buildLogFile(id: string, runsDir = getConfig().runsDir): string {
  return path.join(runsDir, ".builds", id, "build.log");
}

function appendBuildLog(id: string, chunk: string, runsDir?: string): void {
  const file = buildLogFile(id, runsDir);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, chunk, { flag: "a" });
}

export function canRestoreBuild(build: Build | undefined): build is Build {
  return Boolean(build && build.status === "SUCCEEDED" && build.snapshotPath);
}

export function captureBuildsEnabled(): boolean {
  return process.env.BUILD_CAPTURE !== "0";
}

function ensureEnvironment(input: {
  envId?: string;
  name?: string;
  repoUrls: string[];
  orgId: string;
  environmentJson?: EnvironmentJson;
}): Environment {
  const existing = input.envId ? getEnvironment(input.envId) : undefined;
  const createdAt = now();
  if (existing) {
    if (!input.environmentJson) {
      return existing;
    }
    return upsertEnvironment({
      ...existing,
      config: { ...existing.config, ...input.environmentJson, repos: existing.config.repos ?? input.repoUrls },
      updatedAt: createdAt,
    });
  }
  return upsertEnvironment({
    id: input.envId ?? `env_${crypto.randomUUID()}`,
    orgId: input.orgId,
    name: input.name ?? input.repoUrls[0] ?? "environment",
    environmentJsonPath: null,
    config: { ...(input.environmentJson ?? {}), repos: input.repoUrls },
    secrets: [],
    createdAt,
    updatedAt: createdAt,
  });
}

function writeEnvironmentOverlay(workspaceDir: string, config: EnvironmentJson | undefined, force: boolean): void {
  if (!config) {
    return;
  }
  if (!force && findInstallTargets(workspaceDir).length > 0) {
    return;
  }
  if (!config.install && !force) {
    return;
  }
  const dest = path.join(workspaceDir, ".neo", "environment.json");
  mkdirSync(path.dirname(dest), { recursive: true });
  writeFileSync(dest, `${JSON.stringify(config, null, 2)}\n`);
}

export async function restoreBuildSnapshot(build: Build, dest: string, runsDir?: string): Promise<void> {
  const src = build.snapshotPath ?? snapshotPathFor(build.id, runsDir);
  await copyWorkspaceTree(src, dest);
}

export async function snapshotWorkspace(buildId: string, workspaceDir: string, runsDir?: string): Promise<string> {
  const dest = snapshotPathFor(buildId, runsDir);
  rmSync(dest, { recursive: true, force: true });
  await copyWorkspaceTree(workspaceDir, dest);
  return dest;
}

export async function captureWorkspaceBuild(input: {
  workspaceDir: string;
  repoUrls: string[];
  ref?: string | null;
  envId?: string | null;
  source?: Build["source"];
  draft?: boolean;
  name?: string;
}): Promise<Build | null> {
  if (!captureBuildsEnabled() || input.repoUrls.length === 0) {
    return null;
  }
  const fingerprint = environmentFingerprint({ repoUrls: input.repoUrls, ref: input.ref });
  const env = ensureEnvironment({
    envId: input.envId ?? undefined,
    name: input.name,
    repoUrls: input.repoUrls,
    orgId: getConfig().orgId,
  });
  const createdAt = now();
  const build: Build = {
    id: crypto.randomUUID(),
    envId: env.id,
    envVersionId: env.id,
    orgId: env.orgId,
    status: "IN_PROGRESS",
    source: input.source ?? "agent",
    draft: input.draft === true,
    snapshotId: null,
    snapshotPath: null,
    fingerprint,
    repoUrls: input.repoUrls,
    ref: input.ref ?? null,
    createdAt,
    completedAt: null,
    failureMessage: null,
  };
  writeBuild(build);
  try {
    const snapshotPath = await snapshotWorkspace(build.id, input.workspaceDir);
    build.status = "SUCCEEDED";
    build.snapshotId = `snap_${build.id}`;
    build.snapshotPath = snapshotPath;
    build.completedAt = now();
    writeBuild(build);
    if (!build.draft && build.snapshotPath) {
      void refillWarmPool(build.id, build.snapshotPath).catch((error) => console.error("warm pool refill failed", error));
    }
    return build;
  } catch (error) {
    build.status = "FAILED";
    build.failureMessage = error instanceof Error ? error.message : "snapshot failed";
    build.completedAt = now();
    writeBuild(build);
    return build;
  }
}

export async function createEnvironmentBuild(input: CreateBuildRequest): Promise<Build> {
  const config = getConfig();
  const fingerprint = environmentFingerprint({ repoUrls: input.repoUrls, ref: input.ref });
  const env = ensureEnvironment({
    envId: input.envId,
    name: input.name,
    repoUrls: input.repoUrls,
    orgId: config.orgId,
    environmentJson: input.environmentJson,
  });
  const createdAt = now();
  const build: Build = {
    id: crypto.randomUUID(),
    envId: env.id,
    envVersionId: env.id,
    orgId: env.orgId,
    status: "IN_PROGRESS",
    source: input.source ?? "manual",
    draft: input.draft === true,
    snapshotId: null,
    snapshotPath: null,
    fingerprint,
    repoUrls: input.repoUrls,
    ref: input.ref ?? null,
    createdAt,
    completedAt: null,
    failureMessage: null,
  };
  writeBuild(build);
  const workspaceDir = snapshotPathFor(build.id);
  try {
    rmSync(workspaceDir, { recursive: true, force: true });
    appendBuildLog(build.id, `materialize ${input.repoUrls.join(" ")}\n`);
    await materializeRepos(input.repoUrls, workspaceDir, repoRoot());
    writeEnvironmentOverlay(workspaceDir, input.environmentJson ?? env.config, Boolean(input.environmentJson));
    const targets = findInstallTargets(workspaceDir);
    for (const target of targets) {
      appendBuildLog(build.id, `$ ${target.command}\n`);
      const result = await runInstallCommand(target.cwd, target.command);
      if (result.stdout) {
        appendBuildLog(build.id, result.stdout);
      }
      if (result.stderr) {
        appendBuildLog(build.id, result.stderr);
      }
      if (result.code !== 0) {
        throw new Error((result.stderr || result.stdout || `install exited ${result.code}`).trim().slice(-4000));
      }
    }
    build.status = "SUCCEEDED";
    build.snapshotId = `snap_${build.id}`;
    build.snapshotPath = workspaceDir;
    build.completedAt = now();
    writeBuild(build);
    if (!build.draft && build.snapshotPath) {
      await refillWarmPool(build.id, build.snapshotPath);
    }
    return build;
  } catch (error) {
    build.status = "FAILED";
    build.failureMessage = error instanceof Error ? error.message : "build failed";
    build.completedAt = now();
    writeBuild(build);
    appendBuildLog(build.id, `\nFAILED ${build.failureMessage}\n`);
    return build;
  }
}
