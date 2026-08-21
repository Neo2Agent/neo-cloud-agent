import type { RunDiagnostics } from "@neo-cloud-agent/contracts";
import { asString, callControlPlane } from "./client.js";
import { readWorkspaceLogs } from "./logs.js";
import { defineExtension, type CloudToolContext, type CloudToolDefinition, type CloudToolResult } from "./types.js";

export const neoDiag = defineExtension({
  name: "neo-diag",
  description: "Let the agent inspect this run's setup logs, egress denials, and environment version.",
});

export type DiagSection = "all" | "setup" | "egress" | "environment";

const SECTIONS = new Set<DiagSection>(["all", "setup", "egress", "environment"]);

function sectionOf(value: unknown): DiagSection {
  const raw = asString(value).trim() as DiagSection;
  return SECTIONS.has(raw) ? raw : "all";
}

function mergeLogs(
  remote: Array<{ name: string; content: string }> | undefined,
  local: Array<{ name: string; content: string }>,
): Array<{ name: string; content: string }> {
  const byName = new Map<string, { name: string; content: string }>();
  for (const item of remote ?? []) {
    if (item.name) {
      byName.set(item.name, item);
    }
  }
  for (const item of local) {
    if (!byName.has(item.name) || !byName.get(item.name)?.content) {
      byName.set(item.name, item);
    }
  }
  return [...byName.values()];
}

function formatDiagnostics(section: DiagSection, data: RunDiagnostics): string {
  const lines: string[] = [];
  if (section === "all" || section === "environment") {
    lines.push("Environment");
    lines.push(`  run: ${data.run.id}`);
    lines.push(`  status: ${data.run.status}`);
    lines.push(`  setupStatus: ${data.run.setupStatus ?? "null"}`);
    lines.push(`  model: ${data.run.model}`);
    lines.push(`  branch: ${data.run.branchName ?? "none"} (base ${data.run.baseBranch ?? "unknown"})`);
    lines.push(`  envId: ${data.run.envId ?? "none"}`);
    lines.push(`  envVersionId: ${data.run.envVersionId ?? "none"}`);
    lines.push(`  buildId: ${data.run.buildId ?? "none"}`);
    if (data.environment) {
      lines.push(`  environment: ${data.environment.name} (${data.environment.id})`);
      if (data.environment.environmentJsonPath) {
        lines.push(`  environmentJsonPath: ${data.environment.environmentJsonPath}`);
      }
    }
    if (data.build) {
      lines.push(
        `  build: ${data.build.id} ${data.build.status}${data.build.draft ? " draft" : ""} fingerprint=${data.build.fingerprint}`,
      );
    }
    if (data.run.errorMessage) {
      lines.push(`  error: ${data.run.errorMessage}`);
    }
    lines.push(`  repos: ${data.run.repoUrls.join(", ") || "none"}`);
  }
  if (section === "all" || section === "egress") {
    lines.push("Egress");
    lines.push(`  mode: ${data.egress.mode}`);
    lines.push(`  domains: ${(data.egress.domains ?? []).join(", ") || "(default)"}`);
    const denials = data.events.filter((item) => item.kind === "egress.denied");
    if (denials.length === 0) {
      lines.push("  denials: none");
    } else {
      for (const item of denials.slice(-20)) {
        lines.push(`  denied: ${item.title}${item.detail ? ` — ${item.detail}` : ""}`);
      }
    }
  }
  if (section === "all" || section === "setup") {
    lines.push("Setup");
    const setup = data.events.filter(
      (item) =>
        item.kind.startsWith("run.") ||
        item.kind.startsWith("scm.") ||
        item.kind === "build.used" ||
        item.kind === "mcp.auth_error",
    );
    if (setup.length === 0) {
      lines.push("  events: none");
    } else {
      for (const item of setup.slice(-40)) {
        lines.push(`  ${item.kind}: ${item.title}${item.detail ? ` — ${item.detail}` : ""}`);
      }
    }
    if (data.logs.length === 0) {
      lines.push("  logs: none");
    } else {
      for (const log of data.logs) {
        lines.push(`  --- ${log.name} ---`);
        lines.push(log.content.trimEnd() || "(empty)");
      }
    }
  }
  return lines.join("\n");
}

export async function executeDiagnostics(
  ctx: CloudToolContext,
  params: Record<string, unknown>,
): Promise<CloudToolResult> {
  const section = sectionOf(params.section);
  const localLogs = readWorkspaceLogs(ctx.workspaceDir);
  try {
    const remote = await callControlPlane<RunDiagnostics>(
      ctx,
      `/internal/runs/${encodeURIComponent(ctx.runId)}/diagnostics`,
    );
    const merged: RunDiagnostics = {
      ...remote,
      logs: mergeLogs(remote.logs, localLogs),
    };
    return {
      content: formatDiagnostics(section, merged),
      details: {
        section,
        setupStatus: merged.run.setupStatus,
        envId: merged.run.envId,
        envVersionId: merged.run.envVersionId,
        buildId: merged.run.buildId,
        egressMode: merged.egress.mode,
        denialCount: merged.events.filter((item) => item.kind === "egress.denied").length,
      },
    };
  } catch (error) {
    if (localLogs.length > 0) {
      return {
        content: [
          `Control plane diagnostics unavailable: ${error instanceof Error ? error.message : "error"}`,
          "Local setup logs:",
          ...localLogs.flatMap((log) => [`--- ${log.name} ---`, log.content.trimEnd() || "(empty)"]),
        ].join("\n"),
        details: { section, localOnly: true },
      };
    }
    return {
      content: error instanceof Error ? error.message : "diagnostics failed",
      isError: true,
    };
  }
}

export function createDiagnosticsTool(ctx: CloudToolContext): CloudToolDefinition {
  return {
    name: "neo_diag",
    label: "Neo Diagnostics",
    description:
      "Inspect this run's setup logs, egress denials, environment version, and active build. Use when install/start failed or a host was blocked.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        section: {
          type: "string",
          enum: ["all", "setup", "egress", "environment"],
          description: "Which slice to return. Default all.",
        },
      },
    },
    execute: (params) => executeDiagnostics(ctx, params),
  };
}
