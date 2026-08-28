/** Whether the OS toast / approval dialog should fire for a desk assignment. */
export function deskAssignmentAlert(input: {
  alreadyLocal: boolean;
  startingHere: boolean;
  windowFocused: boolean;
  requireApproval: boolean;
}): "silent" | "notify" | "approve" {
  if (input.alreadyLocal || input.startingHere) {
    return "silent";
  }
  if (input.requireApproval) {
    return "approve";
  }
  // The person at this machine just sent; don't toast every worker wake.
  if (input.windowFocused) {
    return "silent";
  }
  return "notify";
}
