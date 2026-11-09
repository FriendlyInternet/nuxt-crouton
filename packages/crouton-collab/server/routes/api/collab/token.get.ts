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
import { resolveTokenRoom } from '../../../utils/collabTeamAccess'

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

  // The client may send a slug or an id; the token and room key carry the canonical id.
  const { teamId, roomKey } = await resolveTokenRoom(event, getQuery(event), session.user.id)

  const token = await signCollabToken({ userId: session.user.id, teamId, room: roomKey }, secret)

  return { token, teamId }
})
