import { secretValuesFromEnv } from "@neo-cloud-agent/contracts";

const extra = new Set<string>();

export function rememberSecret(value: string | null | undefined): void {
  if (value && value.length >= 8) {
    extra.add(value);
  }
}

export function controlPlaneSecrets(): string[] {
  return secretValuesFromEnv(process.env, [...extra]);
}

export function resetRememberedSecrets(): void {
  extra.clear();
}
