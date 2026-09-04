import assert from "node:assert/strict";
import test from "node:test";
import { applyTermChunk, createTermScreen, termScreenText } from "./term-render.js";

function render(chunk: string): string {
  return termScreenText(applyTermChunk(createTermScreen(), chunk));
}

test("plain text and newlines stay as typed", () => {
  assert.equal(render("hello\nworld"), "hello\nworld");
});

test("CR moves to the start of the line without wiping it", () => {
  assert.equal(render("~ $ ls\r\nfiles\r\n~ $ "), "~ $ ls\nfiles\n~ $ ");
});

test("CR plus overwrite redraws the current line", () => {
  assert.equal(render("hello\rworld"), "world");
});

test("backspace moves the cursor so the next char overwrites", () => {
  assert.equal(render("abc\b\bd"), "adc");
});

test("CSI K erases from the cursor to the end of the line", () => {
  assert.equal(render("hello\b\b\x1b[K"), "hel");
});

test("CSI 2J clears the screen", () => {
  assert.equal(render("old\ntext\x1b[2Jnext"), "next");
});

test("SGR and bracketed-paste modes are ignored", () => {
  assert.equal(render("\x1b[?2004h\x1b[32mhi\x1b[0m\x1b[?2004l"), "hi");
});

test("incomplete CSI is held until the next chunk", () => {
  const mid = applyTermChunk(createTermScreen(), "hi\x1b[");
  assert.equal(termScreenText(mid), "hi");
  assert.equal(termScreenText(applyTermChunk(mid, "K")), "hi");
});

test("a real script+bash transcript keeps one command line", () => {
  const raw =
    "\x1b[?2004h~ $ ls\r\n\x1b[?2004l\ralpha.txt  bravo.txt\r\n\x1b[?2004h~ $ ";
  assert.equal(render(raw), "~ $ ls\nalpha.txt  bravo.txt\n~ $ ");
});

test("tab completion transcript does not echo the command twice", () => {
  const raw = "\x1b[?2004h~ $ ls alpha.txt \r\n\x1b[?2004l\ralpha.txt\r\n\x1b[?2004h~ $ ";
  assert.equal(render(raw), "~ $ ls alpha.txt \nalpha.txt\n~ $ ");
});
