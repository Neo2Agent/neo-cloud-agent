export function ComingSoon({ title, copy }: { title: string; copy: string }) {
  return (
    <div className="workbench-empty">
      <strong>{title}</strong>
      <p>{copy}</p>
      <p className="hint">即将推出</p>
    </div>
  );
}
