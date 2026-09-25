import { useEffect, useRef } from "react";

export type SessionSearchHit = { id: string; title: string; meta: string };

export function SessionSearch({
  query,
  setQuery,
  hits,
  projectHits,
  onOpenRun,
  onOpenProject,
  onClose,
}: {
  query: string;
  setQuery: (value: string) => void;
  hits: SessionSearchHit[];
  projectHits?: SessionSearchHit[];
  onOpenRun: (id: string) => void;
  onOpenProject?: (id: string) => void;
  onClose: () => void;
}) {
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  return (
    <div className="palette-backdrop" role="presentation" onClick={onClose}>
      <div
        className="palette palette-float"
        role="dialog"
        aria-modal="true"
        aria-label="搜索对话"
        onClick={(event) => event.stopPropagation()}
      >
        <input
          ref={searchRef}
          className="palette-input"
          value={query}
          placeholder="搜索对话、项目…"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onClose();
            }
            if (event.key === "Enter" && hits[0]) {
              event.preventDefault();
              onOpenRun(hits[0].id);
            }
          }}
        />
        <div className="palette-body">
          {projectHits && projectHits.length > 0 ? (
            <>
              <p className="palette-label">项目</p>
              {projectHits.map((hit) => (
                <button key={hit.id} type="button" className="palette-row" onClick={() => onOpenProject?.(hit.id)}>
                  <strong>{hit.title}</strong>
                  <span>{hit.meta}</span>
                </button>
              ))}
            </>
          ) : null}
          {hits.length > 0 ? <p className="palette-label">对话</p> : null}
          {hits.map((hit) => (
            <button key={hit.id} type="button" className="palette-row" onClick={() => onOpenRun(hit.id)}>
              <strong>{hit.title}</strong>
              <span>{hit.meta}</span>
            </button>
          ))}
          {hits.length === 0 && !projectHits?.length ? (
            <p className="palette-empty">{query.trim() ? "没有匹配的对话或项目。" : "还没有对话。"}</p>
          ) : null}
        </div>
        <footer className="palette-foot">
          <span>Esc 关闭</span>
          <span>⌘/Ctrl+K</span>
        </footer>
      </div>
    </div>
  );
}
