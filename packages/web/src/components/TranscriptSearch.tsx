import { useMemo, useState } from "react";
import type { TranscriptMessage } from "@neo-cloud-agent/contracts/events";
import { searchTranscript, userQuestions } from "../search";

type Props = {
  messages: TranscriptMessage[];
  onJump: (id: string) => void;
};

export function TranscriptSearch({ messages, onJump }: Props) {
  const [query, setQuery] = useState("");
  const [openQuestions, setOpenQuestions] = useState(false);
  const hits = useMemo(() => searchTranscript(messages, query), [messages, query]);
  const questions = useMemo(() => userQuestions(messages), [messages]);
  if (messages.length === 0) return null;
  return (
    <div className="transcript-search">
      <input
        type="search"
        placeholder="搜索这条对话"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        aria-label="对话内搜索"
      />
      <button type="button" className="ghost" onClick={() => setOpenQuestions((value) => !value)}>
        历史提问
      </button>
      {query.trim() ? (
        <ul className="search-hits">
          {hits.length === 0 ? <li className="hint">没有匹配</li> : null}
          {hits.slice(0, 8).map((item) => (
            <li key={item.id}>
              <button type="button" onClick={() => onJump(item.id)}>
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
              <button type="button" onClick={() => onJump(item.id)}>
                {item.text.replace(/\s+/g, " ").slice(0, 80)}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
