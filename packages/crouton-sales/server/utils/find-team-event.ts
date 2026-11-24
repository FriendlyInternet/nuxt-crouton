/**
 * @crouton-package crouton-sales
 * @description Load a sales event by id AND team (#4391) — the team check a
 * helper token's event access needs. A scoped-access token names one event
 * (`resourceId`) and the team it was made for (`organizationId`); matching only
 * the id lets a token for team A open team B's event. Both are in the WHERE, so
 * another team's event and a missing event give the same 404 — the answer never
 * reveals that the id exists for someone else.
 *
 * The table is injected: it lives in the consuming app's generated layer, which
 * a package unit test cannot resolve (same split as `cancel-order.ts`).
 */
import { and, eq } from 'drizzle-orm'

export async function findTeamEvent(
  db: any,
  table: any,
  eventId: string,
  organizationId: string
) {
  const [salesEvent] = await db
    .select()
    .from(table)
    .where(and(eq(table.id, eventId), eq(table.teamId, organizationId)))
    .limit(1)
  if (!salesEvent) {
    throw createError({ status: 404, statusText: 'Event not found' })
  }
  return salesEvent
}
