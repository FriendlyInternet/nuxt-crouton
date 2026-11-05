import { nanoid } from 'nanoid'
import { sqliteTable, text, integer, real, customType, uniqueIndex } from 'drizzle-orm/sqlite-core'

// Custom JSON column that handles NULL values gracefully during LEFT JOINs
const jsonColumn = customType<any>({
  dataType() {
    return 'text'
  },
  fromDriver(value: unknown): any {
    if (value === null || value === undefined || value === '') {
      return null
    }
    try {
      return JSON.parse(value as string)
    } catch {
      return null
    }
  },
  toDriver(value: any): string {
    return JSON.stringify(value)
  },
})

export const crateLookups = sqliteTable('crate_lookups', {
  id: text('id').primaryKey().$default(() => nanoid()),

  teamId: text('teamId').notNull(),
  owner: text('owner').notNull(),
  trackId: text('trackId').notNull(),
  fetchedAt: integer('fetchedAt', { mode: 'timestamp' }).notNull().$default(() => new Date()),
  results: jsonColumn('results').$default(() => ({})),

  createdAt: integer('createdAt', { mode: 'timestamp' }).notNull().$default(() => new Date()),
  updatedAt: integer('updatedAt', { mode: 'timestamp' }).notNull().$onUpdate(() => new Date()),
  createdBy: text('createdBy').notNull(),
  updatedBy: text('updatedBy').notNull()
}, (table) => [
  uniqueIndex('crate_lookups_team_track_id_idx').on(table.teamId, table.trackId)
])