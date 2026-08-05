/**
 * Round-robin assignee rotation for chores (#1937).
 *
 * Pure function: given the current assignee and the household's fixed
 * cyclical order (team member ids, oldest membership first), returns the
 * next assignee id, wrapping around after the last member. Kept dependency
 * free so it's testable without booting the DB/auth stack.
 */
export function getNextAssignee(currentAssigneeId: string, orderedMemberIds: string[]): string {
  if (orderedMemberIds.length === 0) {
    return currentAssigneeId
  }

  const currentIndex = orderedMemberIds.indexOf(currentAssigneeId)
  if (currentIndex === -1) {
    return orderedMemberIds[0]
  }

  const nextIndex = (currentIndex + 1) % orderedMemberIds.length
  return orderedMemberIds[nextIndex]
}
