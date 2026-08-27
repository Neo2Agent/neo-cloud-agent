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
    if (gateway.port && gateway.port !== base.port) {
      base.port = gateway.port;
    } else if (!gateway.port && isLoopbackOrigin(gateway.origin)) {
      base.port = "8081";
    }
    return base.origin;
  } catch {
    base.port = "8081";
    return base.origin;
  }
}
