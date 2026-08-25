export function matchAutomationCommand<T extends { id: string; name: string }>(
  text: string,
  items: T[],
): T | undefined {
  const trimmed = text.trim();
  const labeled = /^\/自动化\s+(.+)$/.exec(trimmed);
  const bare = labeled ? labeled[1]!.trim() : /^\/([^/\s].*)$/.exec(trimmed)?.[1]?.trim();
  if (!bare) return undefined;
  return (
    items.find((item) => item.name === bare || item.id === bare) ??
    items.find((item) => item.name.toLowerCase() === bare.toLowerCase())
  );
}
