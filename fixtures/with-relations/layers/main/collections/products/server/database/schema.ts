import { nanoid } from 'nanoid'
import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core'

export const mainProducts = sqliteTable('main_products', {
  id: text('id').primaryKey().$default(() => nanoid()),

  teamId: text('teamId').notNull(),
  owner: text('owner').notNull(),
  title: text('title').notNull(),
  categoryId: text('categoryId'),
  price: real('price'),
  inStock: integer('inStock', { mode: 'boolean' }).$default(() => true),

  createdAt: integer('createdAt', { mode: 'timestamp' }).notNull().$default(() => new Date()),
  updatedAt: integer('updatedAt', { mode: 'timestamp' }).notNull().$onUpdate(() => new Date()),
  createdBy: text('createdBy').notNull(),
  updatedBy: text('updatedBy').notNull()
})