/**
 * Issue a short-lived HMAC-signed collab token for cross-origin WebSocket auth.
 *
 * Flow:
 * 1. Client fetches this endpoint (same-origin, session cookies sent automatically)
 * 2. Server validates session + team membership, creates token with userId, team, room + expiry, signs with HMAC
 * 3. Client passes token as query param when connecting to cross-origin collab worker
 * 4. CollabRoom DO verifies HMAC signature and expiry — no callback needed
 */
import { signCollabToken } from '../../../utils/collabToken'
import { getServerSession } from '@fyit/crouton-auth/server/utils/useServerAuth'
import { getMembership, getTeamById, getTeamBySlug } from '@fyit/crouton-auth/server/utils/team'

export default defineEventHandler(async (event) => {
  const session = await getServerSession(event)
  if (!session?.user) {
    throw createError({ status: 401, statusText: 'Unauthorized' })
  }

  // Dedicated COLLAB_TOKEN_SECRET (same value on the app and the collab Worker) — no fallback.
  const secret = process.env.COLLAB_TOKEN_SECRET
  if (!secret) {
    throw createError({ status: 500, statusText: 'Server misconfigured: COLLAB_TOKEN_SECRET is not set' })
  }

  const query = getQuery(event)
  const teamIdent = typeof query.teamId === 'string' ? query.teamId : ''
  const room = typeof query.room === 'string' ? query.room : ''
  if (!teamIdent || !room) {
    throw createError({ status: 400, statusText: 'teamId and room are required' })
  }

  // The client may send a slug or an id; the token and room key carry the canonical id.
  const team = (await getTeamById(event, teamIdent)) ?? (await getTeamBySlug(event, teamIdent))
  if (!team) throw createError({ status: 404, statusText: 'Team not found' })

  const membership = await getMembership(event, team.id, session.user.id)
  if (!membership) throw createError({ status: 403, statusText: 'Forbidden' })

  // The room must belong to the team it is requested for (client may use the slug prefix).
  const rest = room.startsWith(`${teamIdent}:`) ? room.slice(teamIdent.length + 1)
    : room.startsWith(`${team.id}:`) ? room.slice(team.id.length + 1) : null
  if (!rest) throw createError({ status: 403, statusText: 'Room is not in this team' })
  const roomKey = `${team.id}:${rest}`

  const token = await signCollabToken({ userId: session.user.id, teamId: team.id, room: roomKey }, secret)

  return { token, teamId: team.id }
})
