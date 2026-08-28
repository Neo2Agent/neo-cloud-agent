import type { BindDeskWorkspaceRequest, Desk, DeskAssignment, DeskLeaseResponse, DeskWorkspace } from "@neo-cloud-agent/contracts";

export type LeaseClient = {
  register(input: { name?: string; hostname?: string; platform?: string; userToken: string }): Promise<{
    deskId: string;
    token: string;
  }>;
  listDesks(userToken: string): Promise<Desk[]>;
  deleteDesk(userToken: string, deskId: string): Promise<void>;
  /** Publish or hide this machine for remote dispatch. Needs the user token. */
  setAllowRemote(userToken: string, deskId: string, allowRemote: boolean): Promise<void>;
  waitAssignment(input: { deskId: string; deskToken: string; waitMs?: number }): Promise<DeskAssignment | null>;
  claim(input: {
    deskId: string;
    deskToken: string;
    runId: string;
    workspaceDir: string;
    pid?: number;
  }): Promise<void>;
  reject(input: { deskId: string; deskToken: string; runId: string; reason?: string }): Promise<void>;
  /** Tell the control plane this machine's worker for a run has exited. */
  release(input: { deskId: string; deskToken: string; runId: string; code?: number | null }): Promise<void>;
  bindWorkspace(input: { deskId: string; deskToken: string } & BindDeskWorkspaceRequest): Promise<DeskWorkspace>;
  unbindWorkspace(input: { deskId: string; deskToken: string; workspaceId: string }): Promise<void>;
};

export function createLeaseClient(baseUrl: string, fetchImpl: typeof fetch = fetch): LeaseClient {
  const root = baseUrl.replace(/\/$/, "");
  const deskPost = async (
    deskId: string,
    deskToken: string,
    action: string,
    body: unknown,
    fallback: string,
  ): Promise<Response> => {
    const response = await fetchImpl(`${root}/v1/desks/${deskId}/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${deskToken}` },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const failed = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(failed.error || fallback);
    }
    return response;
  };
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
    async listDesks(userToken) {
      const response = await fetchImpl(`${root}/v1/desks`, {
        headers: { authorization: `Bearer ${userToken}` },
      });
      const body = (await response.json()) as { desks?: Desk[]; error?: string };
      if (!response.ok) {
        throw new Error(body.error || "list desks failed");
      }
      return body.desks ?? [];
    },
    async setAllowRemote(userToken, deskId, allowRemote) {
      const response = await fetchImpl(`${root}/v1/desks/${deskId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", authorization: `Bearer ${userToken}` },
        body: JSON.stringify({ allowRemote }),
      });
      if (!response.ok) {
        const failed = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(failed.error || "update desk failed");
      }
    },
    async deleteDesk(userToken, deskId) {
      const response = await fetchImpl(`${root}/v1/desks/${deskId}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${userToken}` },
      });
      if (!response.ok && response.status !== 404) {
        const failed = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(failed.error || "delete desk failed");
      }
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
      await deskPost(
        input.deskId,
        input.deskToken,
        "claim",
        { runId: input.runId, workspaceDir: input.workspaceDir, pid: input.pid },
        "desk claim failed",
      );
    },
    async reject(input) {
      await deskPost(
        input.deskId,
        input.deskToken,
        "reject",
        { runId: input.runId, reason: input.reason },
        "desk reject failed",
      );
    },
    async release(input) {
      await deskPost(
        input.deskId,
        input.deskToken,
        "release",
        { runId: input.runId, code: input.code ?? null },
        "desk release failed",
      );
    },
    async bindWorkspace(input) {
      const response = await deskPost(
        input.deskId,
        input.deskToken,
        "workspaces",
        { name: input.name, repoKey: input.repoKey, git: input.git },
        "bind workspace failed",
      );
      return (await response.json()) as DeskWorkspace;
    },
    async unbindWorkspace(input) {
      const response = await fetchImpl(`${root}/v1/desks/${input.deskId}/workspaces/${input.workspaceId}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${input.deskToken}` },
      });
      if (!response.ok) {
        const failed = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(failed.error || "unbind workspace failed");
      }
    },
  };
}
