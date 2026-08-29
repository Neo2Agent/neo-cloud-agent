import type { ReactNode } from "react";
import { IconComputer } from "../icons";
import { IslandButton } from "../island";
import type { LocalRunView } from "./local-run-view";

function folderName(value: string): string {
  return (value || "").replace(/[\\/]+$/, "").split(/[\\/]/).pop() || value;
}

export function LocalRunMeta({
  view,
  placeLabel,
  otherCount,
  onResume,
}: {
  view: LocalRunView;
  placeLabel: string;
  otherCount: number;
  onResume: () => void;
}): ReactNode {
  if (!view.isLocal) return null;
  const folder = folderName(view.folder);
  return (
    <div className="local-meta">
      <IconComputer size={14} />
      <span className="local-meta-place">{placeLabel}</span>
      {folder ? (
        <>
          <span className="local-meta-sep" aria-hidden>
            ·
          </span>
          <span className="local-meta-folder">{folder}</span>
        </>
      ) : null}
      {view.status?.state === "starting" ? <span className="local-meta-state is-warn">启动中</span> : null}
      {view.status?.state === "running" ? <span className="local-meta-state is-run">运行中</span> : null}
      {view.status?.state === "failed" ? (
        <span className="local-meta-state is-fail">{view.status.detail || "启动失败"}</span>
      ) : null}
      {view.idle ? <span className="local-meta-state">就绪</span> : null}
      {view.needsRestart ? (
        <IslandButton type="default" title="重新在这台电脑上拉起这条对话的 Agent 进程" onClick={onResume}>
          在这台电脑上继续
        </IslandButton>
      ) : null}
      {otherCount > 0 ? <em title="另外这些对话也在这台电脑上改文件">另有 {otherCount} 条在本机跑</em> : null}
    </div>
  );
}
