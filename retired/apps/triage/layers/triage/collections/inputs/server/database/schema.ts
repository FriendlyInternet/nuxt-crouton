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

export const triageInputs = sqliteTable('triage_inputs', {
  id: text('id').primaryKey().$default(() => nanoid()),

  teamId: text('teamId').notNull(),
  owner: text('owner').notNull(),

  order: integer('order').notNull().$default(() => 0),
  flowId: text('flowId').notNull(),
  sourceType: text('sourceType').notNull(),
  name: text('name').notNull(),
  apiToken: text('apiToken'),
  accountId: text('accountId'),
  webhookUrl: text('webhookUrl'),
  webhookSecret: text('webhookSecret'),
  emailAddress: text('emailAddress'),
  emailSlug: text('emailSlug'),
  sourceMetadata: jsonColumn('sourceMetadata').$default(() => ({})),
  active: integer('active', { mode: 'boolean' }).notNull().$default(() => true),

  createdAt: integer('createdAt', { mode: 'timestamp' }).notNull().$default(() => new Date()),
  updatedAt: integer('updatedAt', { mode: 'timestamp' }).notNull().$onUpdate(() => new Date()),
  createdBy: text('createdBy').notNull(),
  updatedBy: text('updatedBy').notNull()
})