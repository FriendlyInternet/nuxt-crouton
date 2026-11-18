/**
 * GET /api/teams/[id]/can?actions=pages:edit,collections:manage
 *
 * Answers, for the signed-in member, which of the asked actions they may do
 * in this team: `{ 'pages:edit': true, 'collections:manage': false }` (#4104).
 * Unknown actions answer false. Used by `useCan()`.
 */
import { getQuery } from 'h3'
import { resolveTeamAndCheckMembership } from '../../../utils/team'
import { canMany } from '../../../utils/permissions'

/** Parse `?actions=a,b` (or repeated `?actions=a&actions=b`) into a unique list. */
function parseActionsQuery(raw: unknown): string[] {
  const parts = (Array.isArray(raw) ? raw : [raw])
    .filter((v): v is string => typeof v === 'string')
    .flatMap(v => v.split(','))
    .map(v => v.trim())
    .filter(Boolean)
  return [...new Set(parts)].slice(0, 50)
}

export default defineEventHandler(async (event) => {
  const { team, user } = await resolveTeamAndCheckMembership(event)
  const actions = parseActionsQuery(getQuery(event).actions)

  // One membership read + one checker for all of them (not one per action).
  return await canMany(team.id, user.id, actions, event)
})
