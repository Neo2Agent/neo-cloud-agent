import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { RuntimeSpec } from "@neo-cloud-agent/contracts";
import { buildFirecrackerCalls, FirecrackerRuntime, tapPlan, writeRunBootstrap } from "./firecracker.js";

function spec(runId: string, workspace: string): RuntimeSpec {
  return {
    runId,
    image: "unused",
    snapshotId: null,
    cpu: 2,
    memoryMiB: 1024,
    diskGiB: 1,
    egress: { mode: "allow_all", domains: [] },
    jwt: "run-jwt",
    model: "neo/deepseek",
    hostWorkspaceDir: workspace,
    workspaceMount: "/workspace",
    controlPlaneUrl: "http://172.16.0.1:8080",
    llmGatewayUrl: "http://172.16.0.1:8081",
  };
}

test("tap plan is deterministic and stays on a /30", () => {
  const first = tapPlan("11111111-1111-1111-1111-111111111111");
  const again = tapPlan("11111111-1111-1111-1111-111111111111");
  assert.deepEqual(first, again);
  assert.match(first.name, /^nca/);
  assert.equal(first.prefix, 30);
  assert.match(first.guestMac, /^AA:FC:/);
});

test("firecracker calls boot kernel, rootfs, workspace disk, vsock, tap, then start", () => {
  const calls = buildFirecrackerCalls(
    spec("run-fc-1", "/tmp/ws"),
    {
      kernel: "/opt/neo/vmlinux",
      rootfs: "/opt/neo/rootfs.ext4",
      workspaceImg: "/tmp/ws/.neo/firecracker/workspace.ext4",
      vsock: "/tmp/ws/.neo/firecracker/vsock.sock",
    },
    tapPlan("run-fc-1"),
  );
  assert.equal(calls[0]?.path, "/machine-config");
  assert.equal(calls.some((item) => item.path === "/boot-source"), true);
  assert.equal(calls.some((item) => item.path === "/drives/root"), true);
  assert.equal(calls.some((item) => item.path === "/drives/workspace"), true);
  assert.equal(calls.some((item) => item.path === "/vsock"), true);
  assert.equal(calls.some((item) => item.path === "/network-interfaces/eth0"), true);
  assert.deepEqual(calls.at(-1), { method: "PUT", path: "/actions", body: { action_type: "InstanceStart" } });
});

test("FirecrackerRuntime.provision talks to the API and writes a bootstrap file", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "neo-fc-"));
  const kernel = path.join(root, "vmlinux");
  const rootfs = path.join(root, "rootfs.ext4");
  writeFileSync(kernel, "k");
  writeFileSync(rootfs, "r");
  const calls: string[] = [];
  const runtime = new FirecrackerRuntime({
    bin: "/usr/bin/false",
    kernel,
    rootfs,
    net: "tap",
    runCommand: async (command, args) => {
      calls.push(`${command} ${args.join(" ")}`);
      return { code: 0, stdout: "", stderr: "" };
    },
    spawnProcess: async () => ({ pid: 4242, stop() {} }),
    waitForSocket: async () => undefined,
    request: async (_sock, method, urlPath) => {
      calls.push(`${method} ${urlPath}`);
      return { status: 204, text: "" };
    },
  });
  const launch = spec("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", path.join(root, "ws"));
  const handle = await runtime.provision(launch);
  assert.equal(handle.runtime, "firecracker");
  assert.equal(handle.pid, 4242);
  assert.ok(handle.socket);
  assert.match(writeRunBootstrap(launch), /run-bootstrap\.json$/);
  assert.equal(calls.some((item) => item.startsWith("ip tuntap")), true);
  assert.equal(calls.includes("PUT /actions"), true);
  await runtime.destroy(handle);
});
