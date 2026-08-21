import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { asString, callControlPlane } from "./client.js";
import { defineExtension, type CloudToolContext, type CloudToolDefinition, type CloudToolResult } from "./types.js";
import { resolveWorkspacePath } from "./workspace-path.js";

export const neoArtifact = defineExtension({
  name: "neo-artifact",
  description: "Upload workspace files through the control plane so the chat page can show or download them.",
});

const TEXT_TYPES = new Set([".txt", ".md", ".log", ".json", ".csv", ".html", ".xml", ".yml", ".yaml", ".ts", ".js", ".css"]);

export type ArtifactUploadResponse = {
  name: string;
  url: string;
  contentType: string;
  sizeBytes: number;
};

function isProbablyText(file: string, sample: Buffer): boolean {
  if (TEXT_TYPES.has(path.extname(file).toLowerCase())) {
    return true;
  }
  return !sample.includes(0);
}

export async function executeArtifactUpload(
  ctx: CloudToolContext,
  params: Record<string, unknown>,
): Promise<CloudToolResult> {
  const rel = asString(params.path).trim();
  if (!rel) {
    return { content: "path is required.", isError: true };
  }
  let file: string;
  try {
    file = resolveWorkspacePath(ctx.workspaceDir, rel);
  } catch (error) {
    return { content: error instanceof Error ? error.message : "invalid path", isError: true };
  }
  let stat;
  try {
    stat = statSync(file);
  } catch {
    return { content: `file not found: ${rel}`, isError: true };
  }
  if (!stat.isFile()) {
    return { content: `${rel} is not a file.`, isError: true };
  }
  const raw = readFileSync(file);
  const name = asString(params.name).trim() || path.basename(file);
  const encoding = isProbablyText(file, raw.subarray(0, 512)) ? "utf8" : "base64";
  try {
    const uploaded = await callControlPlane<ArtifactUploadResponse>(
      ctx,
      `/internal/runs/${encodeURIComponent(ctx.runId)}/artifacts`,
      {
        method: "POST",
        body: JSON.stringify({
          name,
          content: encoding === "utf8" ? raw.toString("utf8") : raw.toString("base64"),
          encoding,
          contentType: asString(params.contentType).trim() || undefined,
        }),
      },
    );
    return {
      content: `Uploaded ${uploaded.name} (${uploaded.sizeBytes} bytes). ${uploaded.url}`,
      details: { ...uploaded },
    };
  } catch (error) {
    return {
      content: error instanceof Error ? error.message : "upload failed",
      isError: true,
    };
  }
}

export function createArtifactTool(ctx: CloudToolContext): CloudToolDefinition {
  return {
    name: "neo_artifact_upload",
    label: "Neo Artifact",
    description:
      "Upload a workspace file (log, screenshot, report) to the control plane so the user can open it in chat. Do not paste large binaries into the reply.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["path"],
      properties: {
        path: { type: "string", description: "Workspace-relative file path" },
        name: { type: "string", description: "Optional download name" },
        contentType: { type: "string", description: "Optional MIME type" },
      },
    },
    execute: (params) => executeArtifactUpload(ctx, params),
  };
}
