import { nanoid } from 'nanoid'
import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const links = sqliteTable('links', {
  id: text('id').primaryKey().$default(() => nanoid()),

  teamId: text('teamId').notNull(),
  owner: text('owner').notNull(),
  title: text('title').notNull(),
  url: text('url').notNull(),
  tags: text('tags'),

  createdAt: integer('createdAt', { mode: 'timestamp' }).notNull().$default(() => new Date()),
  updatedAt: integer('updatedAt', { mode: 'timestamp' }).notNull().$onUpdate(() => new Date()),
  createdBy: text('createdBy').notNull(),
  updatedBy: text('updatedBy').notNull()
}, (table) => [
  uniqueIndex('links_team_title_idx').on(table.teamId, table.title)
])
