import type { H3Event } from 'h3'
import { getMembership, getTeamById, getTeamBySlug } from '@fyit/crouton-auth/server/utils/team'

/**
 * Resolve a team by id-or-slug and verify the user is a member.
 * Throws 404 (unknown team, when `notFound`) or 403 (not a member).
 */
export async function requireTeamMember(event: H3Event, teamIdent: string, userId: string, notFound = false) {
  const team = (await getTeamById(event, teamIdent)) ?? (await getTeamBySlug(event, teamIdent))
  if (!team && notFound) throw createError({ status: 404, statusText: 'Team not found' })
  const membership = team ? await getMembership(event, team.id, userId) : null
  if (!team || !membership) throw createError({ status: 403, statusText: 'Forbidden' })
  return team
}

/** Strip the team prefix (slug or id) from a room name; null if it is not in this team. */
export function roomWithinTeam(room: string, teamIdent: string, teamId: string): string | null {
  for (const prefix of [`${teamIdent}:`, `${teamId}:`]) {
    if (room.startsWith(prefix)) return room.slice(prefix.length) || null
  }
  return null
}

/**
 * Validate a token request's query and resolve the canonical team + room key.
 * Throws 400 (missing params), 404/403 (team), 403 (room outside the team).
 */
export async function resolveTokenRoom(event: H3Event, query: Record<string, unknown>, userId: string) {
  const teamIdent = typeof query.teamId === 'string' ? query.teamId : ''
  const room = typeof query.room === 'string' ? query.room : ''
  if (!teamIdent || !room) {
    throw createError({ status: 400, statusText: 'teamId and room are required' })
  }
  const team = await requireTeamMember(event, teamIdent, userId, true)
  const rest = roomWithinTeam(room, teamIdent, team.id)
  if (!rest) throw createError({ status: 403, statusText: 'Room is not in this team' })
  return { teamId: team.id, roomKey: `${team.id}:${rest}` }
}
