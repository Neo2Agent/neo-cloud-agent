import { canManageProject } from "@neo-cloud-agent/contracts/project";
import type { Project } from "@neo-cloud-agent/contracts/project";
import type { ProjectAsset } from "@neo-cloud-agent/contracts/project-asset";
import { useCallback, useEffect, useState } from "react";
import { api, readJson } from "../api";
import { IslandButton } from "../island";
import { displayName, formatRel } from "./helpers";

function prettySize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AssetsTab({ token, project, userId }: { token: string; project: Project; userId: string }) {
  const [items, setItems] = useState<ProjectAsset[]>([]);
  const [error, setError] = useState("");
  const manage = canManageProject(project.members.find((item) => item.userId === userId)?.role);

  const refresh = useCallback(async () => {
    const response = await api(token, `/v1/projects/${project.id}/assets`);
    if (!response.ok) return;
    const body = await readJson<{ assets?: ProjectAsset[] }>(response);
    setItems(body.assets ?? []);
  }, [project.id, token]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="workbench-stack">
      <div className="workbench-row">
        <p className="hint">对话里的文件要手动保存过来，不会自动进项目。</p>
        <label className="ghost file-upload">
          上传文件
          <input
            type="file"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = () => {
                const result = String(reader.result ?? "");
                const content = result.includes(",") ? result.slice(result.indexOf(",") + 1) : result;
                void api(token, `/v1/projects/${project.id}/assets`, {
                  method: "POST",
                  body: JSON.stringify({ path: file.name, content, encoding: "base64", contentType: file.type }),
                }).then(async (response) => {
                  if (!response.ok) {
                    setError((await readJson<{ error?: string }>(response)).error || "上传失败");
                    return;
                  }
                  await refresh();
                });
              };
              reader.readAsDataURL(file);
              event.target.value = "";
            }}
          />
        </label>
      </div>
      {items.length === 0 ? (
        <div className="workbench-empty">
          <strong>还没有项目资产</strong>
          <p>上传文件，或从对话产物里点「保存到项目」。</p>
        </div>
      ) : (
        <ul className="task-list">
          {items.map((item) => (
            <li key={item.id} className="asset-row">
              <span className="task-copy">
                <strong>{item.path}</strong>
                <span className="task-tags">
                  <em>{prettySize(item.size)}</em>
                  <em>{item.source === "run" ? "来自对话" : "上传"}</em>
                  <em>{displayName(item.createdEmail)}</em>
                </span>
              </span>
              <span className="task-ago">{formatRel(item.updatedAt)}</span>
              <IslandButton
                type="text"
                onClick={() => {
                  void api(token, `/v1/projects/${project.id}/assets/${item.id}`)
                    .then(async (response) => {
                      if (!response.ok) throw new Error("下载失败");
                      const blob = await response.blob();
                      const url = URL.createObjectURL(blob);
                      const link = document.createElement("a");
                      link.href = url;
                      link.download = item.path.split("/").pop() ?? item.path;
                      link.click();
                      URL.revokeObjectURL(url);
                    })
                    .catch((err) => setError(err instanceof Error ? err.message : "下载失败"));
                }}
              >
                下载
              </IslandButton>
              {manage ? (
                <IslandButton
                  type="default"
                  danger
                  onClick={() => {
                    void api(token, `/v1/projects/${project.id}/assets/${item.id}`, { method: "DELETE" }).then(async (response) => {
                      if (!response.ok) {
                        setError((await readJson<{ error?: string }>(response)).error || "删除失败");
                        return;
                      }
                      await refresh();
                    });
                  }}
                >
                  删除
                </IslandButton>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}
