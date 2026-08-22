export interface CloudExtension {
  name: string;
  description: string;
}

export function defineExtension(extension: CloudExtension): CloudExtension {
  return extension;
}

export type CloudToolFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface CloudToolContext {
  runId: string;
  controlPlaneUrl: string;
  jwt: string;
  workspaceDir: string;
  fetch?: CloudToolFetch;
  /** Worker-injected nested session runner. Missing in unit tests that only check schemas. */
  runSubagent?: (params: Record<string, unknown>) => Promise<CloudToolResult>;
}

export interface CloudToolResult {
  content: string;
  details?: Record<string, unknown>;
  isError?: boolean;
}

export interface CloudToolParameterSchema {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface CloudToolDefinition {
  name: string;
  label: string;
  description: string;
  parameters: CloudToolParameterSchema;
  execute: (params: Record<string, unknown>) => Promise<CloudToolResult>;
}
