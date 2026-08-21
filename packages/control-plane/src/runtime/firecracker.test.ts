import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { RuntimeSpec } from "@neo-cloud-agent/contracts";
import { setTryReflinkForTests } from "../scm/clone.js";
import {
  buildFirecrackerCalls,
  firecrackerHostSupported,
  firecrackerPaths,
  FirecrackerRuntime,
  guestFacingBootstrap,
  rewriteUrlHost,
  tapPlan,
  withTapReachableUrls,
} from "./firecracker.js";

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

test("FIRECRACKER_FORCE bypasses the nested AMX host skip", () => {
  const previous = process.env.FIRECRACKER_FORCE;
  process.env.FIRECRACKER_FORCE = "1";
  try {
    assert.equal(firecrackerHostSupported().ok, true);
  } finally {
    if (previous === undefined) {
      delete process.env.FIRECRACKER_FORCE;
    } else {
      process.env.FIRECRACKER_FORCE = previous;
    }
  }
});

test("rewriteUrlHost swaps only the hostname", () => {
  assert.equal(rewriteUrlHost("http://127.0.0.1:8080", "172.16.1.1"), "http://172.16.1.1:8080");
  assert.equal(rewriteUrlHost("http://127.0.0.1:8081/v1", "172.16.1.1"), "http://172.16.1.1:8081/v1");
  assert.equal(rewriteUrlHost("file:///workspace", "172.16.1.1"), "file:///workspace");
});

test("tap-reachable spec keeps the gateway and control plane on the tap host", () => {
  const tap = tapPlan("run-fc-1");
  const guest = withTapReachableUrls(spec("run-fc-1", "/tmp/ws"), tap.hostIp);
  assert.equal(guest.controlPlaneUrl, `http://${tap.hostIp}:8080`);
  assert.equal(guest.llmGatewayUrl, `http://${tap.hostIp}:8081`);
  assert.ok(guest.egress.domains.includes(tap.hostIp));
});

test("guest-facing bootstrap uses the workspace mount and tap host", () => {
  const tap = tapPlan("run-fc-boot");
  const guest = guestFacingBootstrap(
    "run-fc-boot",
    { llmGatewayUrl: "http://127.0.0.1:8081", workspaceDir: "/host/runs/run-fc-boot" },
    "http://127.0.0.1:8080",
  );
  assert.equal(guest.workspaceDir, "/workspace");
  assert.equal(guest.llmGatewayUrl, `http://${tap.hostIp}:8081`);
  assert.equal(guest.controlPlaneUrl, `http://${tap.hostIp}:8080`);
});

test("tap plan is deterministic and stays on a /30", () => {
  const first = tapPlan("11111111-1111-1111-1111-111111111111");
  const again = tapPlan("11111111-1111-1111-1111-111111111111");
  assert.deepEqual(first, again);
  assert.match(first.name, /^nca/);
  assert.equal(first.prefix, 30);
  assert.match(first.guestMac, /^AA:FC:/);
  const second = Number(first.hostIp.split(".")[1]);
  assert.ok(second >= 16 && second <= 31, first.hostIp);
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
  setTryReflinkForTests(async () => false);
  try {
  const root = mkdtempSync(path.join(tmpdir(), "neo-fc-"));
  const kernel = path.join(root, "vmlinux");
  const rootfs = path.join(root, "rootfs.ext4");
  writeFileSync(kernel, "k");
  writeFileSync(rootfs, "r");
  const calls: string[] = [];
  let rootDrive: { path_on_host?: string } | undefined;
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
    request: async (_sock, method, urlPath, body) => {
      calls.push(`${method} ${urlPath}`);
      if (urlPath === "/drives/root") {
        rootDrive = body as { path_on_host?: string };
      }
      return { status: 204, text: "" };
    },
  });
  const launch = spec("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", path.join(root, "ws"));
  const handle = await runtime.provision(launch);
  assert.equal(handle.runtime, "firecracker");
  assert.equal(handle.pid, 4242);
  assert.ok(handle.socket);
  const tap = tapPlan(launch.runId);
  const bootstrap = JSON.parse(readFileSync(path.join(root, "ws", ".neo", "run-bootstrap.json"), "utf8")) as {
    controlPlaneUrl: string;
    llmGatewayUrl: string;
    egress: { domains: string[] };
  };
  assert.equal(bootstrap.controlPlaneUrl, `http://${tap.hostIp}:8080`);
  assert.equal(bootstrap.llmGatewayUrl, `http://${tap.hostIp}:8081`);
  assert.ok(bootstrap.egress.domains.includes(tap.hostIp));
  assert.equal(calls.some((item) => item.startsWith("ip tuntap")), true);
  assert.equal(calls.includes("PUT /actions"), true);
  assert.equal(rootDrive?.path_on_host, rootfs);
  await runtime.destroy(handle);
  } finally {
    setTryReflinkForTests();
  }
});

test("FirecrackerRuntime.provision attaches a reflinked rootfs when CoW works", async () => {
  setTryReflinkForTests(async (src, dest) => {
    await cp(src, dest);
    return true;
  });
  try {
    const root = mkdtempSync(path.join(tmpdir(), "neo-fc-cow-"));
    const kernel = path.join(root, "vmlinux");
    const rootfs = path.join(root, "rootfs.ext4");
    writeFileSync(kernel, "k");
    writeFileSync(rootfs, "r");
    let rootDrive: { path_on_host?: string } | undefined;
    const runtime = new FirecrackerRuntime({
      bin: "/usr/bin/false",
      kernel,
      rootfs,
      net: "none",
      runCommand: async () => ({ code: 0, stdout: "", stderr: "" }),
      spawnProcess: async () => ({ pid: 7, stop() {} }),
      waitForSocket: async () => undefined,
      request: async (_sock, _method, urlPath, body) => {
        if (urlPath === "/drives/root") {
          rootDrive = body as { path_on_host?: string };
        }
        return { status: 204, text: "" };
      },
    });
    const launch = spec("bbbbbbbb-cccc-dddd-eeee-ffffffffffff", path.join(root, "ws"));
    const handle = await runtime.provision(launch);
    assert.equal(rootDrive?.path_on_host, firecrackerPaths(launch).rootfsImg);
    assert.equal(readFileSync(firecrackerPaths(launch).rootfsImg, "utf8"), "r");
    await runtime.destroy(handle);
  } finally {
    setTryReflinkForTests();
  }
});
