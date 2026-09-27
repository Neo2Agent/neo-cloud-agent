import type { CloudSettingsClient } from "@neo-cloud-agent/ui";
import type { MobileClient } from "./api/client.js";

export function cloudSettingsFromMobile(client: MobileClient): CloudSettingsClient {
  return {
    getJson: (path) => client.request("GET", path),
    sendJson: (path, init) => client.request(init?.method ?? "POST", path, init?.body),
  };
}

export function githubAuthorizeHref(apiUrl: string): string {
  return `${apiUrl.replace(/\/$/, "")}/v1/integrations/github/authorize`;
}
