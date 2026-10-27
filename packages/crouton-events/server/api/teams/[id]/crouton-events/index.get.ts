import { and, desc } from 'drizzle-orm'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { croutonEvents } from '../../../../database/schema'
import { buildEventConditions, parseEventFilterQuery } from '../../../../utils/event-filters'

export default defineEventHandler(async (event) => {
  const { team } = await resolveTeamAndCheckMembership(event)
  const db = useDB()

  const query = getQuery(event)
  const filters = parseEventFilterQuery(query)
  const page = query.page ? Number.parseInt(String(query.page), 10) : 1
  const pageSize = query.pageSize ? Number.parseInt(String(query.pageSize), 10) : 50

  const conditions = buildEventConditions({ teamId: team.id, ...filters })
  const offset = (page - 1) * pageSize

  const events = await db
    .select()
    .from(croutonEvents)
    .where(and(...conditions))
    .orderBy(desc(croutonEvents.timestamp))
    .limit(pageSize)
    .offset(offset)

  return events
})
