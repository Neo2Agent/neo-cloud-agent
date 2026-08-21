import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { DockerRuntime, buildDockerRunArgs, spawnDocker } from "./docker.js";
import { assertNoProviderSecrets, buildWorkerEnv, containerName } from "./worker-env.js";

function dockerAvailable(): boolean {
  try {
    if (spawnSync("docker", ["info"], { encoding: "utf8", timeout: 4000 }).status === 0) {
      return true;
    }
    return spawnSync("sudo", ["-n", "docker", "info"], { encoding: "utf8", timeout: 4000 }).status === 0;
  } catch {
    return false;
  }
}

const spec = {
  runId: "run-1",
  image: "neo-cloud-agent-worker:dev",
  snapshotId: null,
  cpu: 2,
  memoryMiB: 1024,
  diskGiB: 10,
  egress: { mode: "allow_all" as const, domains: [] },
  jwt: "jwt-token",
  model: "neo/deepseek",
  hostWorkspaceDir: "/app/.neo/runs/run-1",
  hostWorkspaceBind: "/host/.neo/runs/run-1",
  workspaceMount: "/workspace",
  controlPlaneUrl: "http://host.docker.internal:8080",
  llmGatewayUrl: "http://host.docker.internal:8081",
  dockerNetwork: "neo-cloud-agent",
};

test("docker run args mount the host workspace and inject JWT without provider keys", () => {
  const args = buildDockerRunArgs(spec);
  assert.equal(args[0], "run");
  assert.ok(args.includes("--name"));
  assert.equal(args[args.indexOf("--name") + 1], "neo-run-run-1");
  assert.ok(args.includes("-v"));
  assert.equal(args[args.indexOf("-v") + 1], "/host/.neo/runs/run-1:/workspace");
  assert.ok(args.includes("--network"));
  assert.equal(args[args.indexOf("--network") + 1], "neo-cloud-agent");
  assert.ok(args.some((item) => item === "RUN_ID=run-1" || item.startsWith("RUN_ID=")));
  const joined = args.join("\n");
  assert.match(joined, /LLM_GATEWAY_JWT=jwt-token/);
  assert.doesNotMatch(joined, /DEEPSEEK_API_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY|LLM_API_KEY|GITHUB_TOKEN|SCM_PUSH_TOKEN/);
  assert.ok(args.includes("neo-cloud-agent-worker:dev"));
});

test("worker env is a tight allowlist", () => {
  const previous = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = "sk-should-not-leak";
  try {
    const env = buildWorkerEnv({
      runId: "r",
      jwt: "j",
      controlPlaneUrl: "http://cp",
      llmGatewayUrl: "http://gw",
      workspaceDir: "/workspace",
      sessionDir: "/var/neo/sessions",
      model: "neo/deepseek",
    });
    assert.equal(env.RUN_ID, "r");
    assert.equal(env.DEEPSEEK_API_KEY, undefined);
    assert.equal(env.GITHUB_TOKEN, undefined);
    assertNoProviderSecrets(env);
    assert.equal(containerName("abc"), "neo-run-abc");
  } finally {
    if (previous === undefined) {
      delete process.env.DEEPSEEK_API_KEY;
    } else {
      process.env.DEEPSEEK_API_KEY = previous;
    }
  }
});

test("DockerRuntime.provision uses the CLI and destroy removes the container", async () => {
  const calls: string[][] = [];
  const runtime = new DockerRuntime({
    run: async (args) => {
      calls.push(args);
      return { stdout: "deadbeef\n", stderr: "", code: 0 };
    },
  });
  const handle = await runtime.provision(spec);
  assert.equal(handle.runtime, "docker");
  assert.equal(handle.id, "neo-run-run-1");
  assert.equal(calls[0]?.[0], "run");
  await runtime.destroy(handle);
  assert.deepEqual(calls[1], ["rm", "-f", "neo-run-run-1"]);
});

test("DockerRuntime.provision surfaces docker CLI errors", async () => {
  const runtime = new DockerRuntime({
    run: async () => ({ stdout: "", stderr: "image not found", code: 125 }),
  });
  await assert.rejects(() => runtime.provision(spec), /image not found/);
});

test("live docker alpine writes into the mounted workspace", { skip: !dockerAvailable() }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "neo-dock-"));
  const runtime = new DockerRuntime();
  const handle = await runtime.provision({
    ...spec,
    runId: `alpine-${Date.now()}`,
    image: "alpine:3.20",
    hostWorkspaceDir: dir,
    hostWorkspaceBind: dir,
    command: ["sh", "-c", "echo from-container > /workspace/out.txt"],
    memoryMiB: 64,
    cpu: 1,
    dockerNetwork: null,
  });
  try {
    const waited = await spawnDocker(["wait", handle.id]);
    assert.equal(waited.code, 0, waited.stderr);
    assert.equal(existsSync(path.join(dir, "out.txt")), true);
    assert.equal(readFileSync(path.join(dir, "out.txt"), "utf8").trim(), "from-container");
  } finally {
    await runtime.destroy(handle);
    rmSync(dir, { recursive: true, force: true });
  }
});
