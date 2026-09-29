/**
 * Whether the desk id saved on this machine is in the account's desk list.
 *
 * `null` means the list never arrived. Keep the saved desk then: a network
 * failure must not drop a machine this account still owns.
 * `false` means the list arrived and this id is someone else's. Drop it and
 * register again. Do not delete that desk; it still belongs to its owner.
 */
export function savedDeskOwnedBy(listed: Array<{ id: string }> | null, deskId: string): boolean | null {
  if (!deskId) return true;
  if (listed == null) return null;
  return listed.some((item) => item.id === deskId);
}
