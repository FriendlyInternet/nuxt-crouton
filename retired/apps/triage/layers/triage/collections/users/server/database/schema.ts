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

export const triageUsers = sqliteTable('triage_users', {
  id: text('id').primaryKey().$default(() => nanoid()),

  teamId: text('teamId').notNull(),
  owner: text('owner').notNull(),

  order: integer('order').notNull().$default(() => 0),
  sourceType: text('sourceType').notNull(),
  sourceWorkspaceId: text('sourceWorkspaceId').notNull(),
  sourceUserId: text('sourceUserId').notNull(),
  sourceUserEmail: text('sourceUserEmail'),
  sourceUserName: text('sourceUserName'),
  notionUserId: text('notionUserId').notNull(),
  notionUserName: text('notionUserName'),
  notionUserEmail: text('notionUserEmail'),
  mappingType: text('mappingType').notNull(),
  confidence: integer('confidence'),
  active: integer('active', { mode: 'boolean' }).notNull().$default(() => true),
  lastSyncedAt: text('lastSyncedAt'),
  metadata: jsonColumn('metadata').$default(() => ({})),

  createdAt: integer('createdAt', { mode: 'timestamp' }).notNull().$default(() => new Date()),
  updatedAt: integer('updatedAt', { mode: 'timestamp' }).notNull().$onUpdate(() => new Date()),
  createdBy: text('createdBy').notNull(),
  updatedBy: text('updatedBy').notNull()
})