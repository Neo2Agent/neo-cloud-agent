import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { TranscriptMessage } from "@neo-cloud-agent/contracts/events";
import { IconSearch } from "../icons";
import { searchTranscript, userQuestions } from "../search";

type Props = {
  messages: TranscriptMessage[];
  onJump: (id: string) => void;
};

export function TranscriptSearch({ messages, onJump }: Props) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [openQuestions, setOpenQuestions] = useState(false);
  const [pos, setPos] = useState({ top: 0, right: 8 });
  const hits = useMemo(() => searchTranscript(messages, query), [messages, query]);
  const questions = useMemo(() => userQuestions(messages), [messages]);

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = btnRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPos({ top: rect.bottom + 6, right: Math.max(8, window.innerWidth - rect.right) });
    };
    place();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (btnRef.current?.contains(target) || popRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  if (messages.length === 0) return null;

  const jump = (id: string) => {
    onJump(id);
    setOpen(false);
  };

  return (
    <div className="transcript-search">
      <button
        ref={btnRef}
        type="button"
        className={open ? "icon-btn is-on" : "icon-btn"}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="搜索这条对话"
        onClick={() => setOpen((value) => !value)}
      >
        <IconSearch size={16} />
        <span className="tab-label">搜索</span>
      </button>
      {open
        ? createPortal(
            <div
              ref={popRef}
              className="transcript-search-pop"
              role="dialog"
              aria-label="搜索这条对话"
              style={{ top: pos.top, right: pos.right }}
            >
              <div className="transcript-search-row">
                <input
                  type="search"
                  placeholder="搜索这条对话"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  aria-label="对话内搜索"
                  autoFocus
                />
                <button
                  type="button"
                  className={openQuestions ? "icon-btn is-on" : "icon-btn"}
                  onClick={() => setOpenQuestions((value) => !value)}
                >
                  历史提问
                </button>
              </div>
              {query.trim() ? (
                <ul className="search-hits">
                  {hits.length === 0 ? <li className="hint">没有匹配</li> : null}
                  {hits.slice(0, 8).map((item) => (
                    <li key={item.id}>
                      <button type="button" onClick={() => jump(item.id)}>
                        {item.text.replace(/\s+/g, " ").slice(0, 80) || item.kind}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {openQuestions ? (
                <ul className="search-hits">
                  {questions.length === 0 ? <li className="hint">还没有提问</li> : null}
                  {questions.slice(-8).reverse().map((item) => (
                    <li key={item.id}>
                      <button type="button" onClick={() => jump(item.id)}>
                        {item.text.replace(/\s+/g, " ").slice(0, 80)}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
