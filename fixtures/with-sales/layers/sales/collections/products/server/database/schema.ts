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

export const salesProducts = sqliteTable('sales_products', {
  id: text('id').primaryKey().$default(() => nanoid()),

  teamId: text('teamId').notNull(),
  owner: text('owner').notNull(),

  order: integer('order').notNull().$default(() => 0),
  eventId: text('eventId').notNull(),
  categoryId: text('categoryId'),
  locationId: text('locationId'),
  title: text('title').notNull(),
  description: text('description'),
  price: real('price').notNull(),
  isActive: integer('isActive', { mode: 'boolean' }).$default(() => true),
  requiresRemark: integer('requiresRemark', { mode: 'boolean' }).$default(() => false),
  remarkPrompt: text('remarkPrompt'),
  hasOptions: integer('hasOptions', { mode: 'boolean' }).$default(() => false),
  multipleOptionsAllowed: integer('multipleOptionsAllowed', { mode: 'boolean' }).$default(() => false),
  options: jsonColumn('options').$default(() => (null)),

  createdAt: integer('createdAt', { mode: 'timestamp' }).notNull().$default(() => new Date()),
  updatedAt: integer('updatedAt', { mode: 'timestamp' }).notNull().$onUpdate(() => new Date()),
  createdBy: text('createdBy').notNull(),
  updatedBy: text('updatedBy').notNull()
})