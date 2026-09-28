import type { ReactNode } from "react";
import { RUN_MODE_LABELS } from "@neo-cloud-agent/contracts/run";
import { IconCloud, IconComputer } from "../icons";
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
  if (!view.isLocal) {
    return (
      <div className="local-meta">
        <span className="local-meta-pill">
          <IconCloud size={13} />
          <span className="local-meta-place">{RUN_MODE_LABELS.cloud}</span>
        </span>
      </div>
    );
  }
  const remote = placeLabel === RUN_MODE_LABELS.remote;
  const folder = folderName(view.folder);
  return (
    <div className="local-meta">
      <span className="local-meta-pill">
        <IconComputer size={13} />
        <span className="local-meta-place">{placeLabel}</span>
        {folder ? <span className="local-meta-folder">{folder}</span> : null}
      </span>
      {view.status?.state === "starting" ? <span className="local-meta-state is-warn">启动中</span> : null}
      {view.status?.state === "running" ? (
        <span className="local-meta-state is-run">{remote ? "本机工具已连接" : "运行中"}</span>
      ) : null}
      {view.status?.state === "failed" ? (
        <span className="local-meta-state is-fail">{view.status.detail || "启动失败"}</span>
      ) : null}
      {view.needsRestart ? (
        <button type="button" className="local-meta-resume" title="重新在这台电脑上拉起这条对话的 Agent 进程" onClick={onResume}>
          在这台电脑上继续
        </button>
      ) : null}
      {otherCount > 0 ? <em title="另外这些对话也在这台电脑上改文件">另有 {otherCount} 条在本机跑</em> : null}
    </div>
  );
}
