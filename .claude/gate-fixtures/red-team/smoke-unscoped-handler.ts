// Known-bad fixture for the red-team gate smoke (#1035). Shaped like a real
// team-scoped API handler (server/api/teams/[id]/orders/[orderId].get.ts) but
// deliberately SKIPS resolveTeamAndCheckMembership and queries the child
// resource by its id alone — a classic cross-team IDOR: team A can read team
// B's order by guessing/enumerating orderId. No auth/session check at all.
// Committed on purpose — do not "fix" this file, and do not wire it into any
// real router. See .claude/gate-fixtures/README.md.
import { defineEventHandler, getRouterParam } from 'h3'
import { eq } from 'drizzle-orm'
import { useDrizzle } from '../utils/drizzle'
import { orders } from '../database/schema'

export default defineEventHandler(async (event) => {
  // BUG: trusts the URL param directly — no resolveTeamAndCheckMembership,
  // no session check, and the query below doesn't constrain organizationId.
  const orderId = getRouterParam(event, 'orderId')

  const db = useDrizzle()
  const order = await db.query.orders.findFirst({
    where: eq(orders.id, orderId as string),
  })

  return order
})
