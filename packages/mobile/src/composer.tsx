import { useRef, useState, type FormEvent, type PointerEvent } from "react";
import {
  Select,
  browserSpeechCtor,
  classifyPointer,
  holdPadLabel,
  mergeSpokenText,
  modelShortLabel,
  startSpeechRecognition,
  type SpeechSession,
} from "@neo-cloud-agent/ui";

type Props = {
  prompt: string;
  followUp: boolean;
  locked: boolean;
  placeholder: string;
  sending: boolean;
  canStop: boolean;
  model: string;
  onModel: (value: string) => void;
  onPrompt: (value: string) => void;
  onSend: () => void;
  onStop?: () => void;
  onOpenSettings: () => void;
  onOpenPlus: () => void;
};

export function BuddyComposer({
  prompt,
  followUp,
  locked,
  placeholder,
  sending,
  canStop,
  model,
  onModel,
  onPrompt,
  onSend,
  onStop,
  onOpenSettings,
  onOpenPlus,
}: Props) {
  const [typing, setTyping] = useState(false);
  const [holding, setHolding] = useState(false);
  const holdStarted = useRef(0);
  const speechRef = useRef<SpeechSession | null>(null);
  const promptRef = useRef(prompt);
  promptRef.current = prompt;
  const speechCtor = typeof window === "undefined" ? null : browserSpeechCtor(window);
  const empty = !prompt.trim();
  const showHold = !typing && empty && !locked;

  const beginHold = (event: PointerEvent<HTMLButtonElement>) => {
    if (locked || sending) return;
    holdStarted.current = Date.now();
    event.currentTarget.setPointerCapture(event.pointerId);
    if (!speechCtor) return;
    setHolding(true);
    try {
      speechRef.current = startSpeechRecognition(new speechCtor(), (text) => onPrompt(mergeSpokenText("", text)));
    } catch {
      setHolding(false);
      speechRef.current = null;
    }
  };

  const endHold = async () => {
    const kind = classifyPointer(Date.now() - holdStarted.current);
    holdStarted.current = 0;
    const session = speechRef.current;
    speechRef.current = null;
    setHolding(false);
    if (kind === "tap" || !session) {
      setTyping(true);
      document.getElementById("prompt")?.focus();
      return;
    }
    const spoken = await session.stop();
    const next = mergeSpokenText(promptRef.current, spoken);
    if (next !== promptRef.current) onPrompt(next);
    if (spoken && !locked && !sending) onSend();
  };

  return (
    <form
      className="composer buddy-composer"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        if (!locked && !sending) onSend();
      }}
    >
      {showHold ? (
        <button
          type="button"
          className={holding ? "buddy-hold is-holding" : "buddy-hold"}
          onPointerDown={beginHold}
          onPointerUp={() => void endHold()}
          onPointerCancel={() => {
            setHolding(false);
            void speechRef.current?.stop();
            speechRef.current = null;
          }}
        >
          {holdPadLabel({ supported: Boolean(speechCtor), holding, followUp })}
        </button>
      ) : null}
      <textarea
        id="prompt"
        className={showHold ? "buddy-prompt-sr" : undefined}
        value={prompt}
        disabled={locked}
        placeholder={placeholder}
        rows={2}
        onFocus={() => setTyping(true)}
        onBlur={() => {
          if (empty) setTyping(false);
        }}
        onChange={(event) => onPrompt(event.target.value)}
      />
      <div className="buddy-composer-bar">
        <button type="button" className="buddy-icon-btn" aria-label="设置" onClick={onOpenSettings}>
          ⚙
        </button>
        <div className="buddy-model">
          <Select
            size="pill"
            aria-label="模型"
            value={model}
            onValueChange={onModel}
            options={[
              { value: "deepseek-v4-flash", label: modelShortLabel("deepseek-v4-flash") },
              { value: "deepseek-v4-pro", label: modelShortLabel("deepseek-v4-pro") },
            ]}
          />
        </div>
        {canStop ? (
          <button className="stop" type="button" onClick={onStop}>
            停
          </button>
        ) : empty ? null : (
          <button className="send" type="submit" disabled={locked || sending}>
            发送
          </button>
        )}
        <button type="button" className="buddy-plus" aria-label="添加" onClick={onOpenPlus}>
          +
        </button>
      </div>
    </form>
  );
}
