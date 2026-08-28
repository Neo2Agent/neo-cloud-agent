import { formatHandoffMarkdown, type Run } from "@neo-cloud-agent/contracts";
import { listRunArtifacts, putRunArtifact, readRunArtifact } from "../artifacts/artifacts.js";
import { snapshotForRun } from "../events/snapshot.js";
import { putProjectAsset } from "./assets.js";

export function buildHandoffMarkdown(source: Run, note: string, actorEmail: string): string {
  const snapshot = snapshotForRun(source.id);
  return formatHandoffMarkdown({
    fromRunId: source.id,
    fromPrompt: source.prompt,
    note,
    actorEmail,
    messages: snapshot.messages.map((item) => ({ role: item.role, text: item.text })),
    artifacts: [],
    pullRequests: source.pullRequests,
  });
}

export async function attachHandoffPack(input: {
  source: Run;
  target: Run;
  actor: { userId: string; email: string };
  note: string;
}): Promise<string> {
  const artifacts = await listRunArtifacts(input.source.id);
  const markdown = formatHandoffMarkdown({
    fromRunId: input.source.id,
    fromPrompt: input.source.prompt,
    note: input.note,
    actorEmail: input.actor.email,
    messages: snapshotForRun(input.source.id).messages.map((item) => ({ role: item.role, text: item.text })),
    artifacts,
    pullRequests: input.source.pullRequests,
  });
  try {
    await putRunArtifact(input.target.id, {
      name: "HANDOFF.md",
      content: markdown,
      contentType: "text/markdown; charset=utf-8",
    });
  } catch {
    // Transfer still succeeds if the object store rejects the write.
  }
  if (input.source.projectId) {
    try {
      await putProjectAsset(
        input.source.projectId,
        {
          path: `handoffs/${input.source.id.slice(0, 8)}-HANDOFF.md`,
          body: Buffer.from(markdown, "utf8"),
          contentType: "text/markdown; charset=utf-8",
          source: "run",
          runId: input.target.id,
        },
        input.actor,
      );
    } catch {
      // Quota or path errors should not block the transfer.
    }
    for (const artifact of artifacts.filter((item) => item.name !== "HANDOFF.md").slice(0, 12)) {
      const stored = await readRunArtifact(input.source.id, artifact.name).catch(() => null);
      if (!stored) continue;
      try {
        await putProjectAsset(
          input.source.projectId,
          {
            path: `handoffs/${input.source.id.slice(0, 8)}/${artifact.name}`,
            body: stored.body,
            contentType: stored.artifact.contentType,
            source: "run",
            runId: input.target.id,
          },
          input.actor,
        );
      } catch {
        continue;
      }
      if (input.target.id !== input.source.id) {
        try {
          await putRunArtifact(input.target.id, {
            name: artifact.name,
            content: stored.body.toString("base64"),
            encoding: "base64",
            contentType: stored.artifact.contentType,
          });
        } catch {
          continue;
        }
      }
    }
  }
  return markdown;
}
