export function hasSavedSession(token: string): boolean {
  return token.startsWith("neo_sess_");
}
