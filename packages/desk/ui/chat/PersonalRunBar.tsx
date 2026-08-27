export function PersonalRunBar({ running, onAbort }: { running: boolean; onAbort: () => void }) {
  if (!running) return null;
  return (
    <div className="personal-run-bar">
      <span>正在处理当前回合</span>
      <button type="button" className="ghost" title="只打断这一轮回答，Agent 进程继续留着接下一条" onClick={onAbort}>
        停止当前回合
      </button>
    </div>
  );
}
