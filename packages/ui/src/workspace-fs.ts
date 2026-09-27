export type WorkspaceFsEntry = { name: string; path: string; type: "file" | "dir"; size?: number };

export type WorkspaceFsListing = {
  path: string;
  type: "file" | "dir";
  entries?: WorkspaceFsEntry[];
  content?: string;
  truncated?: boolean;
  workspace?: { state?: "present" | "evicted" | "missing"; evictedReason?: string };
};

const FS_READ_FAILED = "读取工作区失败";

export async function readWorkspaceFs(
  request: (path: string, init?: RequestInit) => Promise<Response>,
  runId: string,
  path = "",
  content = false,
): Promise<WorkspaceFsListing> {
  const query = new URLSearchParams();
  if (path) query.set("path", path);
  query.set("content", content ? "1" : "0");
  const response = await request(`/v1/runs/${runId}/fs?${query.toString()}`);
  const body = (await response.json()) as WorkspaceFsListing & { error?: string };
  if (!response.ok) {
    throw new Error(body.error || FS_READ_FAILED);
  }
  return body;
}
