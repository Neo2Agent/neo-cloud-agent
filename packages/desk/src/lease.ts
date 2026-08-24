import type { DeskAssignment, DeskLeaseResponse } from "@neo-cloud-agent/contracts";

export type LeaseClient = {
  register(input: { name?: string; hostname?: string; platform?: string; userToken: string }): Promise<{
    deskId: string;
    token: string;
  }>;
  waitAssignment(input: { deskId: string; deskToken: string; waitMs?: number }): Promise<DeskAssignment | null>;
  claim(input: {
    deskId: string;
    deskToken: string;
    runId: string;
    workspaceDir: string;
    pid?: number;
  }): Promise<void>;
};

export function createLeaseClient(baseUrl: string, fetchImpl: typeof fetch = fetch): LeaseClient {
  const root = baseUrl.replace(/\/$/, "");
  return {
    async register(input) {
      const response = await fetchImpl(`${root}/v1/desks`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${input.userToken}` },
        body: JSON.stringify({ name: input.name, hostname: input.hostname, platform: input.platform }),
      });
      const body = (await response.json()) as { desk?: { id?: string }; token?: string; error?: string };
      if (!response.ok || !body.desk?.id || !body.token) {
        throw new Error(body.error || "desk register failed");
      }
      return { deskId: body.desk.id, token: body.token };
    },
    async waitAssignment(input) {
      const response = await fetchImpl(`${root}/v1/desks/${input.deskId}/lease`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${input.deskToken}` },
        body: JSON.stringify({ waitMs: input.waitMs ?? 20_000 }),
      });
      const body = (await response.json()) as DeskLeaseResponse & { error?: string };
      if (!response.ok) {
        throw new Error(body.error || "desk lease failed");
      }
      return body.assignment ?? null;
    },
    async claim(input) {
      const response = await fetchImpl(`${root}/v1/desks/${input.deskId}/claim`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${input.deskToken}` },
        body: JSON.stringify({ runId: input.runId, workspaceDir: input.workspaceDir, pid: input.pid }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error || "desk claim failed");
      }
    },
  };
}
