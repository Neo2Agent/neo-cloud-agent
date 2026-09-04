export function createTermWriteQueue(write: (data: string) => void, delayMs = 16): {
  push(data: string, immediate?: boolean): void;
  flush(): void;
} {
  let pending = "";
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    if (timer != null) {
      clearTimeout(timer);
      timer = null;
    }
    const data = pending;
    pending = "";
    if (data) {
      write(data);
    }
  };
  return {
    push(data: string, immediate = false) {
      if (!data) {
        return;
      }
      pending += data;
      if (immediate) {
        flush();
        return;
      }
      if (timer == null) {
        timer = setTimeout(flush, delayMs);
      }
    },
    flush,
  };
}
