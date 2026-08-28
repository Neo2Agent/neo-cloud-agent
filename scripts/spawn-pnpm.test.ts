import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pnpmLaunch, quoteWinCmdArg, spawnPnpm } from "./spawn-pnpm.ts";

describe("quoteWinCmdArg", () => {
  it("leaves plain tokens alone", () => {
    assert.equal(quoteWinCmdArg("vite"), "vite");
    assert.equal(quoteWinCmdArg("--config"), "--config");
  });

  it("quotes empty and spaced values for cmd.exe", () => {
    assert.equal(quoteWinCmdArg(""), '""');
    assert.equal(quoteWinCmdArg("F:\\agent harness\\neo-cloud-agent"), '"F:\\agent harness\\neo-cloud-agent"');
    assert.equal(quoteWinCmdArg('say "hi"'), '"say ""hi"""');
  });
});

describe("pnpmLaunch", () => {
  it("spawns pnpm without a cmd shim", () => {
    const launch = pnpmLaunch(["exec", "vite", "--config", "ui/vite.config.ts"]);
    if (process.platform === "win32") {
      if (launch.command === process.execPath) {
        assert.match(launch.args[0] ?? "", /corepack[\\/]dist[\\/]pnpm\.js$/i);
        assert.deepEqual(launch.args.slice(1), ["exec", "vite", "--config", "ui/vite.config.ts"]);
        return;
      }
      assert.equal(launch.command.toLowerCase().includes("cmd"), true);
      assert.deepEqual(launch.args.slice(0, 3), ["/d", "/s", "/c"]);
      assert.equal(launch.args[3], "pnpm exec vite --config ui/vite.config.ts");
      return;
    }
    assert.deepEqual(launch, { command: "pnpm", args: ["exec", "vite", "--config", "ui/vite.config.ts"] });
  });
});

describe("spawnPnpm", () => {
  it("runs pnpm -v", async () => {
    const child = spawnPnpm(["-v"], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout?.on("data", (chunk: Buffer | string) => {
      out += String(chunk);
    });
    const code: number | null = await new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("exit", resolve);
    });
    assert.equal(code, 0);
    assert.match(out.trim(), /^\d+\.\d+\.\d+/);
  });
});
