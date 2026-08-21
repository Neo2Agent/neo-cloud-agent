import type { EgressPolicy, Environment } from "@neo-cloud-agent/contracts";
import { hostnameFromTarget, mergeEgressPolicy } from "@neo-cloud-agent/contracts";
import { getConfig } from "../config.js";
import { findEnvironmentRoots } from "../env/install.js";

export function hostsFromUrls(urls: Array<string | undefined | null>): string[] {
  const hosts: string[] = [];
  for (const url of urls) {
    if (!url) {
      continue;
    }
    const host = hostnameFromTarget(url);
    if (host) {
      hosts.push(host);
    }
  }
  return hosts;
}

export function resolveEgressPolicy(input: {
  workspaceDir?: string;
  env?: Pick<Environment, "config"> | null;
  controlPlaneUrl?: string;
  llmGatewayUrl?: string;
}): EgressPolicy {
  const fromWorkspace = input.workspaceDir
    ? findEnvironmentRoots(input.workspaceDir)
        .map((root) => root.config.egress)
        .find((item) => item?.mode)
    : undefined;
  const fromEnv = input.env?.config.egress;
  const config = getConfig();
  return mergeEgressPolicy(fromWorkspace ?? fromEnv, [
    ...hostsFromUrls([input.controlPlaneUrl ?? config.workerControlPlaneUrl, input.llmGatewayUrl ?? config.workerLlmGatewayUrl]),
  ]);
}
