export type TermScreen = {
  lines: string[];
  row: number;
  col: number;
  pending: string;
};

const MAX_LINES = 2_000;

export function createTermScreen(): TermScreen {
  return { lines: [""], row: 0, col: 0, pending: "" };
}

export function termScreenText(screen: TermScreen): string {
  return screen.lines.join("\n");
}

export function applyTermChunk(screen: TermScreen, chunk: string): TermScreen {
  const next: TermScreen = {
    lines: screen.lines.slice(),
    row: screen.row,
    col: screen.col,
    pending: screen.pending,
  };
  const data = `${next.pending}${chunk}`;
  next.pending = "";
  let i = 0;
  while (i < data.length) {
    const code = data.charCodeAt(i);
    if (code === 0x1b) {
      const consumed = consumeEsc(next, data, i);
      if (consumed < 0) {
        next.pending = data.slice(i);
        break;
      }
      i += consumed;
      continue;
    }
    if (code === 0x07) {
      i += 1;
      continue;
    }
    if (code === 0x08 || code === 0x7f) {
      next.col = Math.max(0, next.col - 1);
      i += 1;
      continue;
    }
    if (code === 0x0d) {
      next.col = 0;
      i += 1;
      continue;
    }
    if (code === 0x0a) {
      next.row += 1;
      next.col = 0;
      ensureRow(next);
      trimLines(next);
      i += 1;
      continue;
    }
    if (code === 0x09) {
      const spaces = 8 - (next.col % 8);
      for (let step = 0; step < spaces; step += 1) {
        writeChar(next, " ");
      }
      i += 1;
      continue;
    }
    if (code < 0x20) {
      i += 1;
      continue;
    }
    writeChar(next, data[i] ?? "");
    i += 1;
  }
  return next;
}

function consumeEsc(screen: TermScreen, data: string, start: number): number {
  const rest = data.slice(start);
  if (rest.length < 2) {
    return -1;
  }
  if (rest[1] === "]") {
    const bel = rest.indexOf("\x07");
    const st = rest.indexOf("\x1b\\");
    const ends = [bel, st === -1 ? -1 : st + 1].filter((value) => value >= 0).sort((a, b) => a - b);
    if (ends.length === 0) {
      return -1;
    }
    return (ends[0] ?? 0) + 1;
  }
  if (rest[1] === "[") {
    const match = /^\x1b\[([?]?)([0-9;]*)([A-Za-z])/.exec(rest);
    if (!match) {
      return /^\x1b\[[?]?[0-9;]*$/.test(rest) ? -1 : 2;
    }
    applyCsi(screen, match[2] ?? "", match[1] === "?", match[3] ?? "");
    return match[0].length;
  }
  if (rest[1] === "(" || rest[1] === ")") {
    return rest.length < 3 ? -1 : 3;
  }
  return 2;
}

function applyCsi(screen: TermScreen, params: string, privateMode: boolean, cmd: string): void {
  if (privateMode || cmd === "m" || cmd === "h" || cmd === "l" || cmd === "n") {
    return;
  }
  const nums = params.split(";").map((part) => (part === "" ? undefined : Number(part)));
  const count = Math.max(1, nums[0] ?? 1);
  switch (cmd) {
    case "A":
      screen.row = Math.max(0, screen.row - count);
      clampCol(screen);
      return;
    case "B":
      screen.row += count;
      ensureRow(screen);
      clampCol(screen);
      return;
    case "C":
      screen.col += count;
      return;
    case "D":
      screen.col = Math.max(0, screen.col - count);
      return;
    case "G":
      screen.col = Math.max(0, (nums[0] ?? 1) - 1);
      return;
    case "H":
    case "f":
      screen.row = Math.max(0, (nums[0] ?? 1) - 1);
      screen.col = Math.max(0, (nums[1] ?? 1) - 1);
      ensureRow(screen);
      return;
    case "K": {
      ensureRow(screen);
      const line = screen.lines[screen.row] ?? "";
      const mode = nums[0] ?? 0;
      if (mode === 1) {
        screen.lines[screen.row] = `${" ".repeat(screen.col)}${line.slice(screen.col)}`;
      } else if (mode === 2) {
        screen.lines[screen.row] = "";
      } else {
        screen.lines[screen.row] = line.slice(0, screen.col);
      }
      return;
    }
    case "J": {
      const mode = nums[0] ?? 0;
      if (mode === 2 || mode === 3) {
        screen.lines = [""];
        screen.row = 0;
        screen.col = 0;
        return;
      }
      if (mode === 0) {
        ensureRow(screen);
        screen.lines[screen.row] = (screen.lines[screen.row] ?? "").slice(0, screen.col);
        screen.lines.splice(screen.row + 1);
      }
      return;
    }
    case "P": {
      ensureRow(screen);
      const line = screen.lines[screen.row] ?? "";
      screen.lines[screen.row] = `${line.slice(0, screen.col)}${line.slice(screen.col + count)}`;
      return;
    }
    case "@": {
      ensureRow(screen);
      const line = screen.lines[screen.row] ?? "";
      screen.lines[screen.row] = `${line.slice(0, screen.col)}${" ".repeat(count)}${line.slice(screen.col)}`;
      return;
    }
    case "X": {
      ensureRow(screen);
      const line = screen.lines[screen.row] ?? "";
      screen.lines[screen.row] = `${line.slice(0, screen.col)}${" ".repeat(count)}${line.slice(screen.col + count)}`;
      return;
    }
    default:
      return;
  }
}

function writeChar(screen: TermScreen, ch: string): void {
  if (!ch) {
    return;
  }
  ensureRow(screen);
  let line = screen.lines[screen.row] ?? "";
  if (screen.col > line.length) {
    line += " ".repeat(screen.col - line.length);
  }
  screen.lines[screen.row] = `${line.slice(0, screen.col)}${ch}${line.slice(screen.col + 1)}`;
  screen.col += 1;
}

function ensureRow(screen: TermScreen): void {
  while (screen.lines.length <= screen.row) {
    screen.lines.push("");
  }
}

function clampCol(screen: TermScreen): void {
  const line = screen.lines[screen.row] ?? "";
  if (screen.col > line.length) {
    screen.col = line.length;
  }
  if (screen.col < 0) {
    screen.col = 0;
  }
}

function trimLines(screen: TermScreen): void {
  if (screen.lines.length <= MAX_LINES) {
    return;
  }
  const drop = screen.lines.length - MAX_LINES;
  screen.lines = screen.lines.slice(drop);
  screen.row = Math.max(0, screen.row - drop);
}
