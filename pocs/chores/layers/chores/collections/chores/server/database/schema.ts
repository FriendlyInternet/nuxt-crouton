import { nanoid } from 'nanoid'
import { sqliteTable, text, integer, real, customType } from 'drizzle-orm/sqlite-core'

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

export const choresChores = sqliteTable('chores_chores', {
  id: text('id').primaryKey().$default(() => nanoid()),

  teamId: text('teamId').notNull(),
  owner: text('owner').notNull(),
  name: text('name').notNull(),
  cadence: text('cadence').notNull(),
  assigneeId: text('assigneeId').notNull(),
  lastDoneById: text('lastDoneById'),
  lastDoneAt: integer('lastDoneAt', { mode: 'timestamp' }).$default(() => new Date()),
  notes: text('notes'),

  createdAt: integer('createdAt', { mode: 'timestamp' }).notNull().$default(() => new Date()),
  updatedAt: integer('updatedAt', { mode: 'timestamp' }).notNull().$onUpdate(() => new Date()),
  createdBy: text('createdBy').notNull(),
  updatedBy: text('updatedBy').notNull()
})