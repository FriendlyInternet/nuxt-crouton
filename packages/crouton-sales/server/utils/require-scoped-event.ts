/**
 * @crouton-package crouton-sales
 * @description Shared preamble for helper-token POS endpoints scoped to one
 * event: validates the `:eventId` route param, requires a scoped-access token
 * for that event, checks the event belongs to the token's team, and opens the
 * DB — the helper-auth analog of `requireTeamEvent`.
 *
 * Extracted to kill the copy-paste the fallow audit flagged as a clone group
 * once a third helper endpoint (`my-orders`) repeated it (the same reason
 * `requireTeamEvent` was extracted in #1324). Throws 400 on a missing param;
 * `requireScopedAccessToResource` throws 401 for an invalid/expired token;
 * `findTeamEvent` throws 404 when the event is not the token's team's (#4391).
 *
 * Every `events/[eventId]/*` endpoint must call this (except the public
 * `by-slug`) — pinned by `test/scoped-event-coverage.test.ts`.
 */
import type { H3Event } from 'h3'
import { requireScopedAccessToResource } from '@fyit/crouton-auth/server/utils/scoped-access'
import { findTeamEvent } from './find-team-event'

export async function requireScopedEvent(event: H3Event) {
  const eventId = getRouterParam(event, 'eventId')
  if (!eventId) {
    throw createError({ status: 400, statusText: 'Event ID is required' })
  }
  const access = await requireScopedAccessToResource(event, 'event', eventId)
  const db = useDB()
  const { salesEvents } = await import('../../collections/events/server/database/schema')
  const salesEvent: typeof salesEvents.$inferSelect = await findTeamEvent(db, salesEvents, eventId, access.organizationId)
  return { eventId, access, db, salesEvent }
}
