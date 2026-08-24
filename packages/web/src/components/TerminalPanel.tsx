type Log = { name: string; content?: string };

type Props = {
  open: boolean;
  loading: boolean;
  error: string;
  logs: Log[];
};

export function TerminalPanel({ open, loading, error, logs }: Props) {
  if (!open) return null;
  return (
    <section className="terminal-panel" id="run-terminal">
      <strong>终端 / setup 日志</strong>
      {loading ? <p className="hint">正在读取…</p> : null}
      {error ? <p className="setup err">{error}</p> : null}
      {!loading && !error && logs.length === 0 ? <p className="hint">还没有 setup 日志。</p> : null}
      {logs.map((log) => (
        <article key={log.name}>
          <p className="eyebrow">{log.name}</p>
          <pre className="terminal-log">{log.content || "（空）"}</pre>
        </article>
      ))}
    </section>
  );
}
