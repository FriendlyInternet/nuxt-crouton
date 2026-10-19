/**
 * Customer-facing endpoint - returns only locations the user is allowed to book
 *
 * Access control logic:
 * - Empty/null allowedMemberIds = open for everyone
 * - Has members in list = restricted to those members only
 */
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { getAllBookingsLocations } from '../../../../../collections/locations/server/database/queries'

export default defineEventHandler(async (event) => {
  const { team, membership } = await resolveTeamAndCheckMembership(event)

  // Get all locations for the team
  const allLocations = await getAllBookingsLocations(team.id)

  // Filter locations by access control:
  // - Empty/null allowedMemberIds = open for everyone
  // - Has members in list = restricted to those members only
  const allowedLocations = allLocations.filter((location: any) => {
    // No restriction set = open for everyone
    if (!location.allowedMemberIds) {
      return true
    }

    // Parse allowedMemberIds if it's a string (JSON)
    let memberIds: string[]
    try {
      memberIds = typeof location.allowedMemberIds === 'string'
        ? JSON.parse(location.allowedMemberIds)
        : location.allowedMemberIds
    }
    catch {
      // Parse error = treat as open
      return true
    }

    // Empty list = open for everyone
    if (!Array.isArray(memberIds) || memberIds.length === 0) {
      return true
    }

    // Has members = restricted to those members
    return memberIds.includes(membership.id)
  })

  return allowedLocations
})
