import assert from "node:assert/strict";
import test from "node:test";
import { createLocalShell, interactiveShellLaunch, shellLaunch } from "./local-shell.js";

test("Windows cmd reads Unicode from stdout, not from stdin", () => {
  const launch = shellLaunch("win32");
  assert.deepEqual(launch.args, ["/d", "/u"]);
  assert.equal(launch.stdoutEncoding, "utf16le");
});

test("unix keeps an interactive login shell", () => {
  const launch = shellLaunch("linux");
  assert.deepEqual(launch.args, ["-i"]);
  assert.equal(launch.stdoutEncoding, "utf8");
});

test("the desk terminal allocates a local pty instead of a dumb pipe", () => {
  const mac = interactiveShellLaunch("darwin", "/tmp/animate-camera");
  assert.equal(mac.command, "python3");
  assert.equal(mac.args[0], "-u");
  assert.match(mac.args[2] ?? "", /pty\.fork/);
  assert.equal(mac.args[3], "/tmp/animate-camera");
  assert.equal(interactiveShellLaunch("win32").command.includes("cmd") || interactiveShellLaunch("win32").args.includes("/u"), true);
});

test("a piped Windows cmd runs a line written as UTF-8", async (t) => {
  if (process.platform !== "win32") {
    t.skip("cmd.exe only");
    return;
  }
  const chunks: string[] = [];
  const shell = createLocalShell({
    cwd: process.cwd(),
    hooks: {
      onData(_id, chunk) {
        chunks.push(chunk);
      },
      onExit() {},
    },
  });
  t.after(() => shell.kill());
  const deadline = Date.now() + 4_000;
  while (!chunks.join("").includes(">") && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  shell.write("echo hi\n");
  const done = Date.now() + 2_000;
  let text = chunks.join("");
  while (!text.includes("hi") && Date.now() < done) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    text = chunks.join("");
  }
  assert.match(text, /hi/);
  assert.equal(text.includes("More?"), false);
});
