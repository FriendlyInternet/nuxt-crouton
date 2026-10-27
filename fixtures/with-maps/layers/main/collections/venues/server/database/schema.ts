import { nanoid } from 'nanoid'
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

export const mainVenues = sqliteTable('main_venues', {
  id: text('id').primaryKey().$default(() => nanoid()),

  teamId: text('teamId').notNull(),
  owner: text('owner').notNull(),
  name: text('name').notNull(),
  street: text('street'),
  city: text('city'),
  postcode: text('postcode'),
  coordinates: text('coordinates'),

  createdAt: integer('createdAt', { mode: 'timestamp' }).notNull().$default(() => new Date()),
  updatedAt: integer('updatedAt', { mode: 'timestamp' }).notNull().$onUpdate(() => new Date()),
  createdBy: text('createdBy').notNull(),
  updatedBy: text('updatedBy').notNull()
})