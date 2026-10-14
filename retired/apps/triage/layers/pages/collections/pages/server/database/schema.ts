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

export const pagesPages = sqliteTable('pages_pages', {
  id: text('id').primaryKey().$default(() => nanoid()),

  teamId: text('teamId').notNull(),
  owner: text('owner').notNull(),

  // Hierarchy fields for tree structure
  parentId: text('parentId'),
  path: text('path').notNull().$default(() => '/'),
  depth: integer('depth').notNull().$default(() => 0),
  order: integer('order').notNull().$default(() => 0),
  title: text('title'),
  slug: text('slug'),
  pageType: text('pageType').notNull(),
  content: text('content'),
  config: jsonColumn('config').$default(() => ({})),
  status: text('status').notNull(),
  visibility: text('visibility').notNull(),
  publishedAt: integer('publishedAt', { mode: 'timestamp' }).$default(() => new Date()),
  showInNavigation: integer('showInNavigation', { mode: 'boolean' }).$default(() => true),
  layout: text('layout'),
  seoTitle: text('seoTitle'),
  seoDescription: text('seoDescription'),

  createdAt: integer('createdAt', { mode: 'timestamp' }).notNull().$default(() => new Date()),
  updatedAt: integer('updatedAt', { mode: 'timestamp' }).notNull().$onUpdate(() => new Date()),
  createdBy: text('createdBy').notNull(),
  updatedBy: text('updatedBy').notNull()
}, (table) => [
  uniqueIndex('pages_pages_team_slug_idx').on(table.teamId, table.slug)
])