type Artifact = { name: string; url?: string; contentType?: string };

type Props = {
  open: boolean;
  loading: boolean;
  error: string;
  artifacts: Artifact[];
  onOpen?: (item: Artifact) => void;
};

export function ArtifactsPanel({ open, loading, error, artifacts, onOpen }: Props) {
  if (!open) return null;
  return (
    <section className="artifacts-panel" id="run-artifacts">
      <strong>产物</strong>
      {loading ? <p className="hint">正在读取…</p> : null}
      {error ? <p className="setup err">{error}</p> : null}
      {!loading && !error && artifacts.length === 0 ? <p className="hint">还没有产物。</p> : null}
      <ul className="artifact-list">
        {artifacts.map((item) => (
          <li key={item.name}>
            <a
              href={item.url || "#"}
              target="_blank"
              rel="noreferrer"
              onClick={(event) => {
                if (onOpen) {
                  event.preventDefault();
                  onOpen(item);
                }
              }}
            >
              {item.name}
            </a>
            {item.contentType ? <small>{item.contentType}</small> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
