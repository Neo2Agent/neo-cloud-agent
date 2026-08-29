import { useEffect, useMemo, useRef, useState } from "react";
import type { TranscriptMessage } from "@neo-cloud-agent/contracts/events";
import { IconSearch } from "../icons";
import { searchTranscript, userQuestions } from "../search";

type Props = {
  messages: TranscriptMessage[];
  onJump: (id: string) => void;
};

export function TranscriptSearch({ messages, onJump }: Props) {
  const rootRef = useRef<HTMLDetailsElement>(null);
  const [query, setQuery] = useState("");
  const [openQuestions, setOpenQuestions] = useState(false);
  const hits = useMemo(() => searchTranscript(messages, query), [messages, query]);
  const questions = useMemo(() => userQuestions(messages), [messages]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const root = rootRef.current;
      if (!root?.open) return;
      if (event.target instanceof Node && root.contains(event.target)) return;
      root.removeAttribute("open");
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  if (messages.length === 0) return null;

  const jump = (id: string) => {
    onJump(id);
    rootRef.current?.removeAttribute("open");
  };

  return (
    <details className="transcript-search" ref={rootRef}>
      <summary className="icon-btn" aria-label="搜索这条对话">
        <IconSearch size={16} />
        <span className="tab-label">搜索</span>
      </summary>
      <div className="transcript-search-pop">
        <div className="transcript-search-row">
          <input
            type="search"
            placeholder="搜索这条对话"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="对话内搜索"
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
      </div>
    </details>
  );
}
