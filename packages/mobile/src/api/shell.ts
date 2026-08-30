export function nextEnvId(current: string, environments: ReadonlyArray<{ id: string }>): string {
  return current || environments[0]?.id || "";
}
