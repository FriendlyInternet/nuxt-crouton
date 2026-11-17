import { nanoid } from 'nanoid'
import { sqliteTable, text, integer, customType } from 'drizzle-orm/sqlite-core'

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

export const inboxCards = sqliteTable('inbox_cards', {
  id: text('id').primaryKey().$default(() => nanoid()),

  teamId: text('teamId').notNull(),
  owner: text('owner').notNull(),
  kind: text('kind').notNull(),
  sourceType: text('sourceType').notNull(),
  sourceNumber: integer('sourceNumber').notNull(),
  sourceCommentId: text('sourceCommentId'),
  title: text('title').notNull(),
  ask: text('ask').notNull(),
  recommendation: text('recommendation'),
  link: text('link').notNull(),
  payload: jsonColumn('payload').$default(() => ({})),
  state: text('state').notNull(),
  answer: text('answer'),
  answerNote: text('answerNote'),
  answeredVia: text('answeredVia'),
  answerUrl: text('answerUrl'),
  askedAt: integer('askedAt', { mode: 'timestamp' }).notNull(),
  answeredAt: integer('answeredAt', { mode: 'timestamp' }),

  createdAt: integer('createdAt', { mode: 'timestamp' }).notNull().$default(() => new Date()),
  updatedAt: integer('updatedAt', { mode: 'timestamp' }).notNull().$onUpdate(() => new Date()),
  createdBy: text('createdBy').notNull(),
  updatedBy: text('updatedBy').notNull()
})