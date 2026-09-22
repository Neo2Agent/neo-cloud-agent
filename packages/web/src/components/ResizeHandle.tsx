const RESIZE_STEP = 16;

type Props = {
  label: string;
  value: number;
  min: number;
  max: number;
  invert?: boolean;
  onChange: (next: number) => void;
  onDragEnd?: (next: number) => void;
};

export function ResizeHandle({ label, value, min, max, invert = false, onChange, onDragEnd }: Props) {
  const clamp = (next: number) => Math.min(max, Math.max(min, Math.round(next)));
  return (
    <div
      className={`resize-handle${invert ? " is-invert" : ""}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      tabIndex={0}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        const startX = event.clientX;
        const start = value;
        let latest = start;
        const move = (ev: PointerEvent) => {
          const delta = ev.clientX - startX;
          latest = clamp(start + (invert ? -delta : delta));
          onChange(latest);
        };
        const up = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
          onDragEnd?.(latest);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      }}
      onKeyDown={(event) => {
        const toward = invert ? -1 : 1;
        if (event.key === "ArrowRight") onChange(clamp(value + toward * RESIZE_STEP));
        if (event.key === "ArrowLeft") onChange(clamp(value - toward * RESIZE_STEP));
      }}
    />
  );
}
