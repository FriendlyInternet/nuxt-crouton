/**
 * HTTP endpoint to get current users in a collaboration room
 *
 * Used by CollabEditingBadge for presence polling.
 * URL: /api/collab/[roomId]/users?type=[roomType]&teamId=[teamId]
 *
 * Auth: Requires a valid session and a teamId the user is a member of (rooms are team-scoped).
 *
 * Example response:
 * {
 *   "users": [{ "user": { "id": "...", "name": "...", "color": "..." }, "cursor": null }],
 *   "count": 1
 * }
 */
import { getRoomUsers } from '../../../../utils/collabRoomStore'
import { getServerSession } from '@fyit/crouton-auth/server/utils/useServerAuth'
import { getMembership, getTeamById, getTeamBySlug } from '@fyit/crouton-auth/server/utils/team'

export default defineEventHandler(async (event) => {
  // --- Auth check: require a valid session ---
  const session = await getServerSession(event)
  if (!session?.user) {
    throw createError({
      status: 401,
      message: 'Unauthorized'
    })
  }

  const rawRoomId = getRouterParam(event, 'roomId')
  const query = getQuery(event)
  const roomType = (query.type as string) || 'page'
  const teamIdent = (query.teamId as string) || ''

  if (!rawRoomId) {
    throw createError({
      status: 400,
      message: 'Missing roomId parameter'
    })
  }

  // --- Team membership check (required) ---
  if (!teamIdent) {
    throw createError({ status: 400, message: 'Missing teamId' })
  }
  const team = (await getTeamById(event, teamIdent)) ?? (await getTeamBySlug(event, teamIdent))
  const membership = team ? await getMembership(event, team.id, session.user.id) : null
  if (!team || !membership) {
    throw createError({ status: 403, message: 'Forbidden' })
  }

  const roomId = `${team.id}:${rawRoomId}`
  const users = getRoomUsers(roomType, roomId)

  return {
    users,
    count: users.length
  }
})
