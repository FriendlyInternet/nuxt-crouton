import { nanoid } from 'nanoid'
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

export const pipelineItems = sqliteTable('pipeline_items', {
  id: text('id').primaryKey().$default(() => nanoid()),

  teamId: text('teamId').notNull(),
  owner: text('owner').notNull(),

  order: integer('order').notNull().$default(() => 0),
  number: integer('number').notNull(),
  title: text('title'),
  url: text('url'),
  stage: text('stage'),
  labels: text('labels'),
  prLabels: text('prLabels'),
  prNumber: integer('prNumber'),
  prHeadSha: text('prHeadSha'),
  prBase: text('prBase'),
  verdict: text('verdict'),
  verdictSha: text('verdictSha'),
  checksRed: integer('checksRed', { mode: 'boolean' }).$default(() => false),
  checksSha: text('checksSha'),
  closedAt: integer('closedAt', { mode: 'timestamp' }),
  stageSince: integer('stageSince', { mode: 'timestamp' }),

  createdAt: integer('createdAt', { mode: 'timestamp' }).notNull().$default(() => new Date()),
  updatedAt: integer('updatedAt', { mode: 'timestamp' }).notNull().$onUpdate(() => new Date()),
  createdBy: text('createdBy').notNull(),
  updatedBy: text('updatedBy').notNull()
})