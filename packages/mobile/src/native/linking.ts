import { parseInviteTokenFromHref, parseRunIdFromHref } from "../api/source";

export async function listenNeoDeepLinks(
  onRun: (runId: string) => void,
  onInvite?: (token: string) => void,
): Promise<() => void> {
  try {
    const Linking = await import("expo-linking");
    const open = (url: string | null) => {
      if (!url) return;
      const runId = parseRunIdFromHref(url);
      if (runId) onRun(runId);
      const invite = parseInviteTokenFromHref(url);
      if (invite) onInvite?.(invite);
    };
    const initial = await Linking.getInitialURL();
    open(initial);
    const sub = Linking.addEventListener("url", (event) => open(event.url));
    return () => sub.remove();
  } catch {
    return () => undefined;
  }
}
