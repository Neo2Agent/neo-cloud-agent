type Props = {
  open: boolean;
  loading: boolean;
  error: string;
  stat: string;
  patch: string;
  committing?: boolean;
  commitError?: string;
  onCommit?: (message: string) => void;
};

export function DiffPanel({ open, loading, error, stat, patch, committing, commitError, onCommit }: Props) {
  if (!open) return null;
  return (
    <section className="diff-panel" id="run-diff">
      <strong>本轮 Diff</strong>
      {onCommit ? (
        <form
          className="diff-commit"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const message = String(data.get("message") ?? "").trim();
            if (message) onCommit(message);
          }}
        >
          <input name="message" placeholder="提交说明" disabled={committing} />
          <button type="submit" disabled={committing}>
            {committing ? "提交中…" : "提交"}
          </button>
          {commitError ? <p className="setup err">{commitError}</p> : null}
        </form>
      ) : null}
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
