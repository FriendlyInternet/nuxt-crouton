/**
 * A till helper token never opens another team's event (#4391).
 *
 * A scoped-access token carries the event it was made for (`resourceId`) AND
 * the team (`organizationId`). The shared `requireScopedEvent` helper used to
 * compare only the event id, so a token for team A was accepted on team B's
 * event. `findTeamEvent` is the lookup the helper now runs with
 * `access.organizationId`; both id and team are in the WHERE.
 *
 * In-memory better-sqlite3 + drizzle, table injected — same pattern as
 * `cancel-order.test.ts` (the real table lives in the consuming app's layer).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { findTeamEvent } from '../server/utils/find-team-event'

const salesEvents = sqliteTable('sales_events', {
  id: text('id').primaryKey(),
  teamId: text('teamId').notNull(),
  title: text('title').notNull()
})

let db: ReturnType<typeof drizzle>

beforeEach(async () => {
  vi.stubGlobal('createError', (o: any) => Object.assign(new Error(o.statusText), o))
  const sqlite = new Database(':memory:')
  sqlite.exec(`CREATE TABLE sales_events (id TEXT PRIMARY KEY, teamId TEXT NOT NULL, title TEXT NOT NULL)`)
  db = drizzle(sqlite)
  await db.insert(salesEvents).values([
    { id: 'event-a', teamId: 'team-a', title: 'Team A fair' },
    { id: 'event-b', teamId: 'team-b', title: 'Team B fair' }
  ])
})

describe('findTeamEvent — the team check behind requireScopedEvent', () => {
  it('(a) returns the event for a team A token on team A\'s event', async () => {
    const event = await findTeamEvent(db, salesEvents, 'event-a', 'team-a')
    expect(event).toMatchObject({ id: 'event-a', teamId: 'team-a', title: 'Team A fair' })
  })

  it('(b) refuses a team A token on team B\'s event with 404', async () => {
    await expect(findTeamEvent(db, salesEvents, 'event-b', 'team-a'))
      .rejects.toMatchObject({ status: 404, statusText: 'Event not found' })
  })

  it('(c) refuses an unknown event id with the same 404', async () => {
    await expect(findTeamEvent(db, salesEvents, 'event-missing', 'team-a'))
      .rejects.toMatchObject({ status: 404, statusText: 'Event not found' })
  })
})
