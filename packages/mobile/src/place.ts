import { isRemoteControlTarget, type ExecutionTarget } from "@neo-cloud-agent/contracts/run";

export const CLOUD_TARGET = { loop: "cloud", tools: "cloud" } as const satisfies ExecutionTarget;

export type RunPlace = "cloud" | "remote";

export function runPlace(run?: { executionTarget?: ExecutionTarget | null } | null): RunPlace {
  return isRemoteControlTarget(run?.executionTarget) ? "remote" : "cloud";
}

export function runPlaceLabel(run?: { executionTarget?: ExecutionTarget | null } | null): string {
  return runPlace(run) === "remote" ? "remote" : "cloud";
}

export const DEFAULT_API_URL = "http://62.234.211.200";
