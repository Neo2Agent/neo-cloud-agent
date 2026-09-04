import { isLoopbackOrigin } from "./ports.js";

/**
 * Production assignments are minted on the app host, so they carry
 * 127.0.0.1:8080 / :8081. A Desk worker is on the user's machine and must
 * use the same public origin the window already talks to.
 */
export function publicizeWorkerUrls(
  assignment: { controlPlaneUrl: string; llmGatewayUrl: string },
  publicControlPlane: string,
): { controlPlaneUrl: string; llmGatewayUrl: string } {
  const publicCp = publicControlPlane.replace(/\/$/, "");
  return {
    controlPlaneUrl: replaceLoopbackOrigin(assignment.controlPlaneUrl, publicCp),
    llmGatewayUrl: replaceLoopbackOrigin(
      assignment.llmGatewayUrl,
      gatewayOriginFor(assignment.llmGatewayUrl, publicCp),
    ),
  };
}

function replaceLoopbackOrigin(url: string, publicOrigin: string): string {
  const trimmed = (url || "").replace(/\/$/, "");
  if (!trimmed || !isLoopbackOrigin(trimmed)) {
    return trimmed;
  }
  return publicOrigin.replace(/\/$/, "");
}

function gatewayOriginFor(gatewayUrl: string, publicCp: string): string {
  const base = new URL(publicCp);
  try {
    const gateway = new URL(gatewayUrl);
    const gatewayPort = gateway.port || (isLoopbackOrigin(gateway.origin) ? "8081" : "");
    if (!gatewayPort || gatewayPort === base.port) {
      return publicCp.replace(/\/$/, "");
    }
    if (base.hostname === "neorun.cloud" || base.hostname === "www.neorun.cloud") {
      return `http://62.234.211.200:${gatewayPort}`;
    }
    base.port = gatewayPort;
    if (gatewayPort === "8081") base.protocol = "http:";
    return base.origin;
  } catch {
    return "http://62.234.211.200:8081";
  }
}
