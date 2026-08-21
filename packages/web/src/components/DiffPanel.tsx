type Props = {
  open: boolean;
  loading: boolean;
  error: string;
  stat: string;
  patch: string;
};

export function DiffPanel({ open, loading, error, stat, patch }: Props) {
  if (!open) return null;
  return (
    <section className="diff-panel" id="run-diff">
      <strong>本轮 Diff</strong>
      {loading ? <p className="hint">正在对比…</p> : null}
      {error ? <p className="setup err">{error}</p> : null}
      {!loading && !error && !stat && !patch ? <p className="hint">工作区没有可展示的 diff。</p> : null}
      {stat ? <pre className="diff-stat">{stat}</pre> : null}
      {patch ? (
        <pre className="tool-diff">
          {patch.split("\n").map((line, index) => (
            <span
              key={index}
              className={line.startsWith("+") ? "diff-add" : line.startsWith("-") ? "diff-del" : "diff-ctx"}
            >
              {line}
              {"\n"}
            </span>
          ))}
        </pre>
      ) : null}
    </section>
  );
}
